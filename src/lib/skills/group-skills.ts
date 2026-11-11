import type { Skill } from "../schemas/resume-data";
import { SKILL_FAMILIES, type SkillFamily } from "./skill-families";

/**
 * Groups a library of skills without a model and without a stored distance
 * matrix.
 *
 * Listed names are a direct lookup. A name that is not listed still joins
 * the family it belongs to when it contains a listed skill ("AWS CDK",
 * "SvelteKit"), extends one, or is a close spelling ("Postgress"). The
 * trigrams for listed names are built once when this module loads, so the
 * check stays local and does not get slower as more users add skills.
 * Other is reserved for a name that matches no family, such as a hobby,
 * and for a private cluster of those names that only relate to each other.
 */

const NEIGHBOR_SCORE = 0.62;

const WEAK_TOKENS = new Set([
  "and",
  "or",
  "the",
  "for",
  "with",
  "of",
  "in",
  "on",
  "to",
  "a",
  "an",
  "web",
  "data",
  "software",
  "development",
  "management",
  "design",
  "system",
  "systems",
  "engineering",
  "engineer",
  "developer",
  "application",
  "applications",
  "service",
  "services",
  "platform",
  "tools",
  "tool",
  "based",
  "using",
  "stack",
]);

export type SkillGroup = {
  id: string;
  label: string;
  skills: Skill[];
};

type ScoredName = {
  score: number;
  strong: boolean;
};

type FamilyRecord = SkillFamily & {
  order: number;
  keys: string[];
};

type Bucket = {
  id: string;
  label: string;
  order: number;
  skills: Skill[];
};

const families: FamilyRecord[] = SKILL_FAMILIES.map((family, order) => ({
  ...family,
  order,
  keys: family.names.map((name) => normalizeSkillName(name)),
}));

const familyByKey = new Map<string, FamilyRecord>();
for (const family of families) {
  for (const key of family.keys) {
    if (!familyByKey.has(key)) familyByKey.set(key, family);
  }
}

const familyByLabel = new Map<string, FamilyRecord>();
for (const family of families) {
  familyByLabel.set(normalizeSkillName(family.label), family);
  familyByLabel.set(family.id, family);
}

const lexiconTrigrams = families.flatMap((family) =>
  family.keys.map((key) => ({
    family,
    key,
    trigrams: trigrams(letters(key)),
  })),
);

const GENERIC_TOKENS = new Set([
  "admin",
  "administration",
  "advanced",
  "api",
  "apis",
  "app",
  "application",
  "applications",
  "backend",
  "basic",
  "cloud",
  "core",
  "data",
  "database",
  "databases",
  "design",
  "development",
  "devops",
  "engineering",
  "enterprise",
  "framework",
  "frontend",
  "integration",
  "integrations",
  "language",
  "languages",
  "library",
  "management",
  "mobile",
  "platform",
  "professional",
  "programming",
  "security",
  "server",
  "servers",
  "service",
  "services",
  "software",
  "sql",
  "system",
  "systems",
  "test",
  "testing",
  "tests",
  "tool",
  "toolkit",
  "tools",
  "web",
]);

const phrases = families.flatMap((family) => {
  const seen = new Set<string>();
  return family.keys.flatMap((key) => {
    if (seen.has(key)) return [];
    seen.add(key);
    const tokens = key.split(" ").filter(Boolean);
    return tokens.length ? [{ family, tokens, key }] : [];
  });
});

const prefixStems = buildPrefixStems();

/**
 * Words that identify a family when the skill name itself was never listed.
 * These are matched only after a listed product name, and only when the
 * skill has no category of its own.
 */
const FAMILY_CUES: Record<string, readonly string[]> = {
  "machine-learning": [
    "classifier",
    "classifiers",
    "regression",
    "inference",
    "neural",
    "embedding",
    "embeddings",
    "finetuning",
    "finetune",
  ],
  "data-science": [
    "analytics",
    "statistic",
    "statistics",
    "dataset",
    "datasets",
    "notebook",
    "visualization",
    "visualisation",
  ],
  "data-engineering": ["warehouse", "orchestration", "ingest", "ingestion"],
  frontend: [
    "browser",
    "stylesheet",
    "stylesheets",
    "markup",
    "responsive",
    "component",
    "components",
  ],
  backend: ["microservice", "microservices", "endpoint", "endpoints"],
  apis: ["webhook", "webhooks", "sdk"],
  databases: [
    "query",
    "queries",
    "schema",
    "schemas",
    "migration",
    "migrations",
  ],
  cloud: ["serverless", "hosting"],
  devops: ["container", "containers", "deployment", "deployments"],
  testing: ["test", "tests", "assertion", "assertions", "coverage"],
  security: [
    "authentication",
    "authorization",
    "vulnerability",
    "vulnerabilities",
    "encryption",
  ],
  design: [
    "wireframe",
    "wireframes",
    "wireframing",
    "prototype",
    "prototypes",
    "prototyping",
    "typography",
    "branding",
  ],
  architecture: ["scalability", "distributed"],
  product: ["roadmap", "stakeholder", "stakeholders", "backlog", "sprint"],
};

const CUE_SUFFIXES = new Set(["ing", "ings", "s", "es", "ed", "er", "ers"]);

export function normalizeSkillName(value: string): string {
  return value
    .replace(/c\+\+/gi, "cplusplus")
    .replace(/c#/gi, "csharp")
    .replace(/f#/gi, "fsharp")
    .replace(/\.net/gi, "dotnet")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function duplicateLexiconNames(): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const family of families) {
    for (const key of family.keys) {
      const prior = seen.get(key);
      if (prior && prior !== family.id)
        duplicates.push(`${key} (${prior}, ${family.id})`);
      else if (!prior) seen.set(key, family.id);
    }
  }
  return duplicates;
}

/** How close two skill names are, from 0 to 1. Identical names score 1. */
export function skillNameSimilarity(left: string, right: string): number {
  return compareNames(left, right).score;
}

export function groupSkills(skills: Skill[]): SkillGroup[] {
  const buckets = new Map<string, Bucket>();
  const pending: Skill[] = [];

  for (const skill of skills) {
    const family = familyForSkill(skill);
    if (family) {
      add(buckets, familyBucket(family), skill);
      continue;
    }
    const category = categoryBucket(skill);
    if (category) {
      add(buckets, category, skill);
      continue;
    }
    pending.push(skill);
  }

  const clusters: Skill[][] = [];
  for (const skill of pending) {
    let bestIndex = -1;
    let best = { score: 0, strong: false };
    clusters.forEach((cluster, index) => {
      const match = bestPair(skill, cluster);
      if (match.score > best.score) {
        best = match;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && accepts(best)) clusters[bestIndex].push(skill);
    else clusters.push([skill]);
  }

  for (const cluster of clusters) {
    if (cluster.length < 2) {
      add(buckets, otherBucket(), cluster[0]);
      continue;
    }
    const label = clusterLabel(cluster);
    add(
      buckets,
      {
        id: `cluster:${slug(label)}`,
        label,
        order: 8_000,
        skills: [],
      },
      cluster[0],
    );
    const bucket = buckets.get(`cluster:${slug(label)}`);
    if (bucket) {
      for (const skill of cluster.slice(1)) bucket.skills.push(skill);
    }
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.skills.length > 0)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    )
    .map(({ id, label, skills: grouped }) => ({ id, label, skills: grouped }));
}

function familyForSkill(skill: Skill): FamilyRecord | null {
  for (const text of skillTexts(skill)) {
    const key = normalizeSkillName(text);
    const exact = familyByKey.get(key);
    if (exact) return exact;
    const contained = containedFamily(key);
    if (contained) return contained;
  }
  if (skill.category?.trim()) return null;
  for (const text of skillTexts(skill)) {
    const key = normalizeSkillName(text);
    const cue = cueFamily(key);
    if (cue) return cue;
    const spelling = spellingFamily(key);
    if (spelling) return spelling;
  }
  return null;
}

function containedFamily(phrase: string): FamilyRecord | null {
  if (!phrase) return null;
  const tokens = phrase.split(" ");
  const matches: Array<{
    family: FamilyRecord;
    key: string;
    tokens: number;
    generic: boolean;
    start: number;
  }> = [];

  for (const phraseEntry of phrases) {
    const span = phraseEntry.tokens;
    for (let start = 0; start <= tokens.length - span.length; start += 1) {
      if (span.every((token, offset) => tokens[start + offset] === token)) {
        matches.push({
          family: phraseEntry.family,
          key: phraseEntry.key,
          tokens: span.length,
          generic: span.every((token) => GENERIC_TOKENS.has(token)),
          start,
        });
      }
    }
  }

  for (const token of tokens) {
    if (familyByKey.has(token)) continue;
    for (const stem of prefixStems) {
      if (!token.startsWith(stem.stem) || token.length === stem.stem.length)
        continue;
      const suffix = token.length - stem.stem.length;
      if (suffix < 2 || suffix > 12) continue;
      matches.push({
        family: stem.family,
        key: stem.stem,
        tokens: 1,
        generic: false,
        start: tokens.indexOf(token),
      });
      break;
    }
  }

  const specific = matches.filter((match) => !match.generic);
  const pool = specific.length ? specific : matches;
  pool.sort(
    (left, right) =>
      right.tokens - left.tokens ||
      left.start - right.start ||
      right.key.length - left.key.length,
  );
  return pool[0]?.family ?? null;
}

function cueFamily(phrase: string): FamilyRecord | null {
  const tokens = phrase.split(" ").filter(Boolean);
  const scores = new Map<string, number>();
  for (const [familyId, cues] of Object.entries(FAMILY_CUES)) {
    for (const cue of cues) {
      const cueTokens = normalizeSkillName(cue).split(" ");
      const matched =
        cueTokens.length === 1
          ? tokens.some((token) => tokenMatchesCue(token, cueTokens[0]))
          : containsSpan(tokens, cueTokens);
      if (matched) scores.set(familyId, (scores.get(familyId) ?? 0) + 1);
    }
  }
  const ranked = [...scores.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1]))
    return null;
  return families.find((family) => family.id === ranked[0][0]) ?? null;
}

function spellingFamily(phrase: string): FamilyRecord | null {
  const compact = letters(phrase);
  if (compact.length < 5) return null;
  const grams = trigrams(compact);
  const bestByFamily = new Map<
    string,
    { family: FamilyRecord; score: number }
  >();
  for (const entry of lexiconTrigrams) {
    if (letters(entry.key).length < 5) continue;
    const score = trigramDice(grams, entry.trigrams);
    const current = bestByFamily.get(entry.family.id);
    if (!current || score > current.score) {
      bestByFamily.set(entry.family.id, { family: entry.family, score });
    }
  }
  const ranked = [...bestByFamily.values()].sort(
    (left, right) => right.score - left.score,
  );
  const best = ranked[0];
  const rival = ranked[1];
  if (!best || best.score < 0.8) return null;
  if (rival && best.score - rival.score < 0.05) return null;
  return best.family;
}

function buildPrefixStems() {
  const stems: Array<{ family: FamilyRecord; stem: string }> = [];
  const seen = new Set<string>();
  const addStem = (family: FamilyRecord, stem: string) => {
    if (stem.length < 4 || GENERIC_TOKENS.has(stem) || seen.has(stem)) return;
    const owner = familyByKey.get(stem);
    if (owner && owner.id !== family.id) return;
    seen.add(stem);
    stems.push({ family, stem });
  };
  for (const family of families) {
    for (const key of family.keys) {
      const tokens = key.split(" ");
      if (tokens.length !== 1) continue;
      addStem(family, tokens[0]);
      const compact = letters(key);
      if (compact.endsWith("js")) addStem(family, compact.slice(0, -2));
    }
  }
  return stems.sort((left, right) => right.stem.length - left.stem.length);
}

function containsSpan(tokens: string[], span: string[]): boolean {
  for (let start = 0; start <= tokens.length - span.length; start += 1) {
    if (span.every((token, offset) => tokens[start + offset] === token))
      return true;
  }
  return false;
}

function tokenMatchesCue(token: string, cue: string): boolean {
  if (token === cue) return true;
  if (cue.length < 6 || !token.startsWith(cue)) return false;
  return CUE_SUFFIXES.has(token.slice(cue.length));
}

function categoryBucket(skill: Skill): Bucket | null {
  const raw = skill.category?.trim();
  if (!raw) return null;
  const key = normalizeSkillName(raw);
  const family = familyByLabel.get(key);
  if (family) return familyBucket(family);
  return {
    id: `category:${slug(key)}`,
    label: raw,
    order: 5_000,
    skills: [],
  };
}

function familyBucket(family: FamilyRecord): Bucket {
  return {
    id: family.id,
    label: family.label,
    order: family.order,
    skills: [],
  };
}

function otherBucket(): Bucket {
  return {
    id: "other",
    label: "Other skills",
    order: 9_000,
    skills: [],
  };
}

function add(buckets: Map<string, Bucket>, bucket: Bucket, skill: Skill) {
  const existing = buckets.get(bucket.id);
  if (existing) existing.skills.push(skill);
  else buckets.set(bucket.id, { ...bucket, skills: [skill] });
}

function bestPair(skill: Skill, others: Skill[]): ScoredName {
  let best = { score: 0, strong: false };
  for (const other of others) {
    for (const left of skillTexts(skill)) {
      for (const right of skillTexts(other)) {
        const match = compareNames(left, right);
        if (match.score > best.score) best = match;
      }
    }
  }
  return best;
}

function accepts(match: ScoredName): boolean {
  if (match.strong) return match.score >= NEIGHBOR_SCORE;
  return match.score >= 0.72;
}

function skillTexts(skill: Skill): string[] {
  return [skill.name, ...skill.aliases];
}

function compareNames(left: string, right: string): ScoredName {
  return compareNormalized(
    normalizeSkillName(left),
    normalizeSkillName(right),
    trigrams(letters(normalizeSkillName(right))),
  );
}

function compareNormalized(
  left: string,
  right: string,
  rightTrigrams: Map<string, number>,
): ScoredName {
  if (!left || !right) return { score: 0, strong: false };
  if (left === right) return { score: 1, strong: true };

  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  if (
    leftTokens.length === 1 &&
    rightTokens.length === 1 &&
    isUnsafePrefix(letters(left), letters(right))
  ) {
    return { score: 0, strong: false };
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let shared = 0;
  let strong = false;
  for (const token of leftSet) {
    if (!rightSet.has(token)) continue;
    shared += 1;
    if (token.length >= 3 && !WEAK_TOKENS.has(token)) strong = true;
  }
  const union = leftSet.size + rightSet.size - shared;
  const jaccard = union ? shared / union : 0;
  const smaller = leftSet.size <= rightSet.size ? leftSet : rightSet;
  const larger = leftSet.size <= rightSet.size ? rightSet : leftSet;
  const contained = [...smaller].every((token) => larger.has(token));
  const containment = contained ? smaller.size / larger.size : 0;
  const dice = trigramDice(trigrams(letters(left)), rightTrigrams);
  const closeSpelling =
    leftTokens.length === 1 &&
    rightTokens.length === 1 &&
    !isUnsafePrefix(letters(left), letters(right)) &&
    Math.abs(letters(left).length - letters(right).length) <= 2 &&
    (letters(left).startsWith(letters(right)) ||
      letters(right).startsWith(letters(left)));
  const score = Math.max(
    jaccard,
    containment * 0.92,
    strong ? 0.64 : 0,
    closeSpelling ? 0.86 : 0,
    dice,
  );
  return {
    score: Math.min(1, score),
    strong: strong || closeSpelling || score >= 0.86,
  };
}

function isUnsafePrefix(left: string, right: string): boolean {
  if (left.length < 2 || right.length < 2) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  return longer.startsWith(shorter) && longer.length - shorter.length > 2;
}

function letters(value: string): string {
  return value.replace(/ /g, "");
}

function trigrams(value: string): Map<string, number> {
  const text = ` ${value} `;
  const counts = new Map<string, number>();
  for (let index = 0; index < text.length - 2; index += 1) {
    const gram = text.slice(index, index + 3);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function trigramDice(
  left: Map<string, number>,
  right: Map<string, number>,
): number {
  let leftTotal = 0;
  let rightTotal = 0;
  let overlap = 0;
  for (const count of left.values()) leftTotal += count;
  for (const count of right.values()) rightTotal += count;
  if (!leftTotal || !rightTotal) return 0;
  for (const [gram, count] of left) {
    overlap += Math.min(count, right.get(gram) ?? 0);
  }
  return (2 * overlap) / (leftTotal + rightTotal);
}

function strongTokens(value: string): string[] {
  return normalizeSkillName(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !WEAK_TOKENS.has(token));
}

function clusterLabel(skills: Skill[]): string {
  const lists = skills.map((skill) => strongTokens(skill.name));
  const shared = lists[0].filter((token) =>
    lists.every((list) => list.includes(token)),
  );
  if (!shared.length) {
    return skills.reduce((shortest, skill) =>
      skill.name.length < shortest.name.length ? skill : shortest,
    ).name;
  }
  const named = skills.find(
    (skill) => normalizeSkillName(skill.name) === shared.join(" "),
  );
  if (named) return named.name;
  return shared.map((token) => tokenCasing(token, skills)).join(" ");
}

function tokenCasing(token: string, skills: Skill[]): string {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])${escapeRegExp(token)}(?![A-Za-z0-9])`,
    "i",
  );
  for (const skill of skills) {
    const match = skill.name.match(pattern);
    if (!match) continue;
    if (match[0] === match[0].toUpperCase() && /[A-Z]/.test(match[0])) {
      return match[0];
    }
    return match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function slug(value: string): string {
  const key = normalizeSkillName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key || "group";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
