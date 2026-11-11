import { assignUser } from "./fixtures.mjs";

const LIBRARY_BYTE_LIMIT = 512_000;

function emptyLibrary(user) {
  return {
    schemaVersion: 2,
    profile: {
      id: "profile",
      fullName: user.displayName,
      email: user.email,
      links: [],
      education: [],
    },
    jobs: [],
    projects: [],
    skills: [],
    credentials: [],
    preferences: {
      sectionOrder: [
        "experience",
        "projects",
        "education",
        "skills",
        "credentials",
      ],
      maxPages: 1,
    },
    githubImportApprovals: [],
  };
}

function utf8(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function writeUnits(bytes) {
  return Math.max(1, Math.ceil(bytes / 1024));
}

function readUnits(bytes) {
  return Math.max(1, Math.ceil(bytes / 4096));
}

export function estimateRun(catalog, config) {
  let changedSaves = 0;
  let pointWrites = 0;
  let maxBytes = 0;
  let finalBytes = 0;
  let libraryWriteUnits = 0;
  let libraryReadUnits = 0;
  for (let userNumber = 1; userNumber <= config.users; userNumber += 1) {
    const user = assignUser(catalog, config.seed, userNumber, "estimate");
    const library = emptyLibrary(user);
    const steps = [
      () => {
        library.profile = {
          ...library.profile,
          fullName: user.profile.fullName,
          ...(user.profile.headline ? { headline: user.profile.headline } : {}),
          ...(user.profile.email ? { email: user.profile.email } : {}),
          ...(user.profile.phone ? { phone: user.profile.phone } : {}),
          ...(user.profile.location ? { location: user.profile.location } : {}),
          links: user.profile.links.map((link) => ({
            label: new URL(link.url).hostname,
            url: link.url,
          })),
        };
      },
      () => {
        library.skills = user.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          aliases: [],
          sources: ["direct-user"],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: [],
        }));
      },
      ...user.jobs.map((job) => () => {
        library.jobs.push({ ...job.changes, id: job.id, points: [] });
      }),
      ...user.projects.map((project) => () => {
        library.projects.push({
          ...project.changes,
          id: project.id,
          repositoryAttachments: [],
          points: [],
        });
      }),
      ...[...user.jobs, ...user.projects].flatMap((parent) =>
        parent.points.map((point) => () => {
          const collection = user.jobs.includes(parent)
            ? library.jobs
            : library.projects;
          collection
            .find((item) => item.id === parent.id)
            .points.push({ id: point.id, text: point.text });
          pointWrites += 1;
        }),
      ),
    ];
    for (const step of steps) {
      step();
      const bytes = utf8(library);
      maxBytes = Math.max(maxBytes, bytes);
      libraryWriteUnits += writeUnits(bytes) + 1;
      libraryReadUnits += readUnits(bytes) + 1;
      changedSaves += 1;
    }
    const bytes = utf8(library);
    finalBytes = Math.max(finalBytes, bytes);
    libraryReadUnits += readUnits(bytes);
  }
  const initializationWrites = config.users * 3;
  return {
    label: "estimated lower bound",
    users: config.users,
    changedSaves,
    pointWrites,
    readBacks: config.users,
    documentWritesLowerBound: initializationWrites + changedSaves * 2,
    initializationDocumentWritesAssumption: initializationWrites,
    maxLibraryUtf8Bytes: maxBytes,
    largestFinalLibraryUtf8Bytes: finalBytes,
    libraryByteLimit: LIBRARY_BYTE_LIMIT,
    approximateEnterpriseWriteUnits: libraryWriteUnits + initializationWrites,
    approximateEnterpriseReadUnits: libraryReadUnits,
    retryAllowanceNotIncluded:
      "Retries, edits, and failed attempts are excluded from this lower bound.",
    unknowns: [
      "Exact Firestore encoded-document size",
      "Index writes",
      "Rules-dependent reads",
      "Provider retries",
      "Browser-triggered extra reads",
      "Authentication traffic",
      "Any live allowance already used",
    ],
  };
}
