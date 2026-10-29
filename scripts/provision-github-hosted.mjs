import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { publishGithubPreviewSecrets } from "./lib/github-preview-secrets.mjs";
import { githubRuntimeIamBindings } from "./lib/github-hosted-iam.mjs";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const project = arg("--project"),
  firebasePackage = arg("--firebase-cli-package"),
  vercelCli = arg("--vercel-cli");
if (
  !process.argv.includes("--apply") ||
  project !==
    JSON.parse(readFileSync(".firebaserc", "utf8")).projects.default ||
  !firebasePackage ||
  !vercelCli
)
  throw new Error(
    "Explicit matching --project, --apply and installed CLI paths are required.",
  );
if (JSON.parse(readFileSync(firebasePackage, "utf8")).version !== "15.34.1")
  throw new Error("Use the pinned Firebase CLI.");
const cli = createRequire(firebasePackage),
  { Command } = cli("./lib/command"),
  { requireAuth } = cli("./lib/requireAuth"),
  { Client } = cli("./lib/apiv2");
let stage = "authentication";
try {
  await new Command("github:provision-preview")
    .before(requireAuth)
    .action(async (options) => {
      if (options.projectId !== project) throw new Error("Unexpected project.");
      const iam = new Client({
          urlPrefix: "https://iam.googleapis.com",
          apiVersion: "v1",
        }),
        projects = new Client({
          urlPrefix: "https://cloudresourcemanager.googleapis.com",
          apiVersion: "v1",
        });
      const accountId = "github-phase-one",
        email = `${accountId}@${project}.iam.gserviceaccount.com`,
        resource = `projects/${project}/serviceAccounts/${email}`;
      stage = "service identity";
      try {
        await iam.get(resource);
      } catch (error) {
        if (error.status !== 404 && error.context?.response?.statusCode !== 404)
          throw error;
        await iam.post(`projects/${project}/serviceAccounts`, {
          accountId,
          serviceAccount: {
            displayName: "Resume Changer phase-one GitHub runtime",
          },
        });
      }
      stage = "account lookup role";
      const rolePath = `projects/${project}/roles/githubPreviewAuthRead`;
      try {
        const role = (await iam.get(rolePath)).body;
        if (
          JSON.stringify(role.includedPermissions) !==
          JSON.stringify(["firebaseauth.users.get"])
        )
          throw new Error("Unexpected role permissions.");
      } catch (error) {
        if (error.status !== 404 && error.context?.response?.statusCode !== 404)
          throw error;
        await iam.post(`projects/${project}/roles`, {
          roleId: "githubPreviewAuthRead",
          role: {
            title: "GitHub Preview account lookup",
            includedPermissions: ["firebaseauth.users.get"],
            stage: "GA",
          },
        });
      }
      stage = "database IAM binding";
      const policy = (
        await projects.post(`projects/${project}:getIamPolicy`, {
          options: { requestedPolicyVersion: 3 },
        })
      ).body;
      policy.version = 3;
      policy.bindings ??= [];
      for (const binding of githubRuntimeIamBindings(
        project,
        "resume-changer",
        email,
      )) {
        const existing = policy.bindings.find(
          (item) =>
            item.role === binding.role &&
            JSON.stringify(item.condition ?? null) ===
              JSON.stringify(binding.condition ?? null),
        );
        if (existing) {
          if (!existing.members.includes(binding.members[0]))
            existing.members.push(binding.members[0]);
        } else policy.bindings.push(binding);
      }
      await projects.post(`projects/${project}:setIamPolicy`, { policy });
      stage = "runtime key creation";
      const previousKeys = process.argv.includes("--rotate")
        ? ((
            await iam.get(`${resource}/keys`, {
              queryParams: { keyTypes: "USER_MANAGED" },
            })
          ).body.keys ?? [])
        : [];
      const created = (
        await iam.post(`${resource}/keys`, {
          privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE",
        })
      ).body;
      try {
        const credentials = JSON.parse(
          Buffer.from(created.privateKeyData, "base64").toString("utf8"),
        );
        if (
          credentials.client_email !== email ||
          credentials.project_id !== project
        )
          throw new Error("Unexpected service identity.");
        stage = "database and account-lookup verification";
        const { initializeApp, cert, deleteApp } =
          await import("firebase-admin/app");
        const { getFirestore } = await import("firebase-admin/firestore");
        const { getAuth } = await import("firebase-admin/auth");
        const app = initializeApp(
          { projectId: project, credential: cert(credentials) },
          "github-provision-probe",
        );
        const db = getFirestore(app, "resume-changer"),
          probe = db.collection("github-internal-phase-one").doc("setup-probe");
        try {
          for (let attempt = 0; ; attempt++)
            try {
              await db.runTransaction(async (transaction) => {
                await transaction.get(probe);
                transaction.set(probe, {
                  purpose: "fictional setup verification",
                  value: 1,
                });
              });
              if ((await probe.get()).data()?.value !== 1)
                throw new Error("Database probe failed.");
              await probe.delete();
              try {
                await getAuth(app).getUser("github-runtime-nonexistent-probe");
              } catch (error) {
                if (error.code !== "auth/user-not-found") throw error;
              }
              break;
            } catch (error) {
              if (attempt >= 5) throw error;
              await new Promise((done) =>
                setTimeout(done, 1000 * 2 ** attempt),
              );
            }
        } finally {
          await deleteApp(app);
        }
        stage = "runtime credential publication";
        publishGithubPreviewSecrets(
          { GITHUB_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(credentials) },
          vercelCli,
          undefined,
          process.argv.includes("--rotate"),
        );
        stage = "old runtime key retirement";
        for (const key of previousKeys)
          if (key.keyType === "USER_MANAGED" && key.name !== created.name)
            await iam.delete(key.name);
      } catch (error) {
        await iam.delete(created.name).catch(() => {});
        throw error;
      }
      console.log(
        JSON.stringify({
          state: "configured",
          identity: email,
          database: "resume-changer",
          environment: "phase-one Preview",
          billingChanged: false,
        }),
      );
    })
    .runner()({ project, nonInteractive: true });
} catch (error) {
  console.error(
    JSON.stringify({
      state: "failed",
      stage,
      status: error.status ?? error.context?.response?.statusCode ?? null,
      message:
        "Hosted runtime provisioning failed. No credentials were printed.",
    }),
  );
  process.exitCode = 1;
}
