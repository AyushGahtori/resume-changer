import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function userSeed(runSeed, userNumber) {
  return (Math.imul(runSeed ^ userNumber, 0x9e3779b1) ^ userNumber) >>> 0;
}

function pick(rng, items, count) {
  const pool = [...items];
  const chosen = [];
  for (let index = 0; index < count; index += 1) {
    const choice = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(choice, 1)[0]);
  }
  return chosen;
}

export async function loadCatalog(fileUrl) {
  const catalog = JSON.parse(await readFile(fileUrl, "utf8"));
  const hash = createHash("sha256")
    .update(JSON.stringify(catalog))
    .digest("hex");
  return { catalog, hash };
}

export function assignUser(catalog, runSeed, userNumber, runId) {
  const rng = mulberry32(userSeed(runSeed, userNumber));
  const jobs = pick(rng, catalog.jobs, 2);
  const projects = pick(rng, catalog.projects, 2);
  const skills = pick(rng, catalog.skills, 12);
  const partial = userNumber % 10 === 0;
  const tag = `lt-${runId}-u${String(userNumber).padStart(4, "0")}`;
  const profile = partial
    ? {
        fullName: `Fictional User ${userNumber}`,
        headline: "",
        email: "",
        phone: "",
        location: "",
        links: [],
      }
    : {
        fullName: `Fictional User ${userNumber}`,
        headline: `Fictional headline ${userNumber}`,
        email: `user-${userNumber}@example.test`,
        phone: `+155501${String(userNumber).padStart(4, "0")}`,
        location: "Berlin",
        links: [{ url: `https://example.test/users/${userNumber}` }],
      };
  const jobRecords = jobs.map((template, index) => ({
    id: `${tag}-job-${index + 1}`,
    templateId: template.templateId,
    changes: partial
      ? {
          company: template.company,
          title: template.title,
          employmentType: "",
          location: "",
          startDate: "",
          endDate: "",
          description: "",
        }
      : {
          company: template.company,
          title: template.title,
          employmentType: template.employmentType,
          location: template.location,
          startDate: template.startDate,
          endDate: template.endDate,
          description: template.description,
        },
    points: template.points.map((text, pointIndex) => ({
      id: `${tag}-job-${index + 1}-point-${pointIndex + 1}`,
      text,
      metric: index === 0 && pointIndex === 0 && !partial,
    })),
  }));
  const projectRecords = projects.map((template, index) => ({
    id: `${tag}-project-${index + 1}`,
    templateId: template.templateId,
    changes: partial
      ? {
          name: template.name,
          role: "",
          url: "",
          description: "",
          startDate: "",
          endDate: "",
        }
      : {
          name: template.name,
          role: template.role,
          url: template.url,
          description: template.description,
          startDate: template.startDate,
          endDate: template.endDate,
        },
    points: template.points.map((text, pointIndex) => ({
      id: `${tag}-project-${index + 1}-point-${pointIndex + 1}`,
      text,
      metric: false,
    })),
  }));
  return {
    userNumber,
    partial,
    browser: false,
    tag,
    email: `user-${userNumber}@example.test`,
    displayName: `Fictional User ${userNumber}`,
    subject: `load-user-${userNumber}`,
    profile,
    skills: skills.map((name) => ({
      id: `${tag}-skill-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,
      name,
    })),
    jobs: jobRecords,
    projects: projectRecords,
  };
}

export function pointPayload(parentType, parentId, point, skillIds) {
  return {
    parentType,
    parentId,
    point: {
      id: point.id,
      text: point.text,
      tags: ["fictional"],
      skillIds: skillIds.slice(0, 2),
      metrics: point.metric
        ? [
            {
              id: `${point.id}-metric`,
              label: "Fictional latency",
              value: "250",
              unit: "ms",
              evidence:
                "Fictional load-test observation, not a measured production result.",
            },
          ]
        : [],
      source: { type: "direct-user", label: "Fictional load test" },
      enabled: true,
    },
  };
}

export function expectedLibrary(assignment, skillIdsByName) {
  const skillIds = assignment.skills.map(
    (skill) => skillIdsByName.get(skill.name.toLowerCase()) ?? skill.id,
  );
  return {
    profile: assignment.profile,
    skillNames: assignment.skills.map((skill) => skill.name),
    jobs: assignment.jobs.map((job) => ({
      ...job,
      points: job.points.map((point) => ({
        ...point,
        skillIds: skillIds.slice(0, 2),
      })),
    })),
    projects: assignment.projects.map((project) => ({
      ...project,
      points: project.points.map((point) => ({
        ...point,
        skillIds: skillIds.slice(0, 2),
      })),
    })),
  };
}

export function verifyLibrary(library, expected) {
  const errors = [];
  const profile = library.profile ?? {};
  for (const [key, value] of Object.entries(expected.profile)) {
    if (key === "links") {
      const urls = (profile.links ?? []).map((link) => link.url);
      const expectedUrls = value.map((link) => link.url);
      if (JSON.stringify(urls) !== JSON.stringify(expectedUrls)) {
        errors.push("profile links");
      }
      continue;
    }
    const actual = profile[key] ?? "";
    if (actual !== value) errors.push(`profile ${key}`);
  }
  const names = (library.skills ?? []).map((skill) => skill.name.toLowerCase());
  for (const name of expected.skillNames) {
    if (!names.includes(name.toLowerCase()))
      errors.push(`missing skill ${name}`);
  }
  if ((library.jobs ?? []).length !== expected.jobs.length)
    errors.push("job count");
  if ((library.projects ?? []).length !== expected.projects.length) {
    errors.push("project count");
  }
  const pointIds = new Set();
  for (const expectedJob of expected.jobs) {
    const job = (library.jobs ?? []).find((item) => item.id === expectedJob.id);
    if (!job) {
      errors.push(`missing job ${expectedJob.id}`);
      continue;
    }
    if ((job.points ?? []).length !== 5) errors.push(`job points ${job.id}`);
    for (const expectedPoint of expectedJob.points) {
      const point = (job.points ?? []).find(
        (item) => item.id === expectedPoint.id,
      );
      if (!point || point.text !== expectedPoint.text) {
        errors.push(`point ${expectedPoint.id}`);
      }
      if (pointIds.has(expectedPoint.id))
        errors.push(`duplicate ${expectedPoint.id}`);
      pointIds.add(expectedPoint.id);
      if (!point) continue;
      for (const skillId of expectedPoint.skillIds ?? []) {
        if (!(point.skillIds ?? []).includes(skillId)) {
          errors.push(`skill reference ${skillId}`);
        }
      }
    }
  }
  for (const expectedProject of expected.projects) {
    const project = (library.projects ?? []).find(
      (item) => item.id === expectedProject.id,
    );
    if (!project) {
      errors.push(`missing project ${expectedProject.id}`);
      continue;
    }
    if ((project.points ?? []).length !== 5)
      errors.push(`project points ${project.id}`);
    for (const expectedPoint of expectedProject.points) {
      const point = (project.points ?? []).find(
        (item) => item.id === expectedPoint.id,
      );
      if (!point || point.text !== expectedPoint.text) {
        errors.push(`point ${expectedPoint.id}`);
      }
      if (pointIds.has(expectedPoint.id))
        errors.push(`duplicate ${expectedPoint.id}`);
      pointIds.add(expectedPoint.id);
      if (!point) continue;
      for (const skillId of expectedPoint.skillIds ?? []) {
        if (!(point.skillIds ?? []).includes(skillId)) {
          errors.push(`skill reference ${skillId}`);
        }
      }
    }
  }
  if (pointIds.size !== 20) errors.push("point total");
  return errors;
}
