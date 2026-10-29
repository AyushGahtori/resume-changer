import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import type { ExecutionContext, JobRecord } from "../../contracts";
const Owner = z
  .object({
    uid: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    importId: z.string().uuid(),
    repositoryId: z.string().regex(/^[1-9][0-9]*$/),
    sessionId: z.string(),
    namespace: z.string(),
    createdAt: z.string(),
  })
  .strict();
export function createHostedJobOwners(
  db: Firestore,
  namespace: string,
  lookupUser: (
    uid: string,
  ) => Promise<{
    disabled: boolean;
    emailVerified: boolean;
    providerData: Array<{ providerId: string }>;
  }>,
) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(namespace))
    throw new Error("Invalid job namespace.");
  const reference = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid job ID.");
    return db.collection(`github-job-owners-${namespace}`).doc(id);
  };
  const index = (uid: string) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
      throw new Error("Invalid account ID.");
    return db
      .collection(`github-account-jobs-${namespace}`)
      .doc(uid)
      .collection("jobs");
  };
  return {
    async bind(
      job: Pick<JobRecord, "id" | "importId" | "createdAt">,
      ctx: ExecutionContext,
      repositoryId: string,
    ) {
      const uid = ctx.access.accountId;
      if (
        !uid ||
        ctx.access.sessionId !== `account-${uid}` ||
        ctx.access.authorizationNamespace !== `firebase:${uid}` ||
        !ctx.access.grantedRepositoryIds.includes(repositoryId)
      )
        throw new Error("Invalid hosted job owner.");
      const owner = Owner.parse({
        uid,
        importId: job.importId,
        repositoryId,
        sessionId: ctx.access.sessionId,
        namespace: ctx.access.authorizationNamespace,
        createdAt: job.createdAt,
      });
      await db.runTransaction(async (transaction) => {
        const target = reference(job.id),
          saved = await transaction.get(target);
        if (
          saved.exists &&
          JSON.stringify(Owner.parse(saved.data())) !== JSON.stringify(owner)
        )
          throw new Error("A job owner cannot change.");
        transaction.set(target, owner);
        transaction.set(index(uid).doc(job.id), { importId: job.importId });
      });
    },
    async resolve(job: Pick<JobRecord, "id" | "importId" | "createdAt">) {
      const owner = Owner.parse((await reference(job.id).get()).data());
      if (
        owner.importId !== job.importId ||
        owner.createdAt !== job.createdAt ||
        owner.sessionId !== `account-${owner.uid}` ||
        owner.namespace !== `firebase:${owner.uid}`
      )
        throw new Error("Job ownership does not match.");
      const user = await lookupUser(owner.uid);
      if (
        user.disabled ||
        !user.emailVerified ||
        !user.providerData.some((p) => p.providerId === "google.com")
      )
        throw new Error("The job account is unavailable.");
      return owner;
    },
    async list(uid: string) {
      return (await index(uid).limit(500).get()).docs.map((item) => item.id);
    },
    async exists(jobId: string) {
      return (await reference(jobId).get()).exists;
    },
  };
}
