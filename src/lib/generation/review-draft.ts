import type { Skill } from "../schemas/resume-data";

export type SkillCategory =
  | "Machine Learning and AI"
  | "Programming Languages"
  | "Frontend Development"
  | "Backend Development"
  | "Databases"
  | "Cloud and Infrastructure"
  | "DevOps and Deployment"
  | "Data Engineering and Analytics"
  | "APIs and Integrations"
  | "Developer Tools"
  | "Other Skills";

export const SKILL_CATEGORY_ORDER: SkillCategory[] = [
  "Machine Learning and AI",
  "Programming Languages",
  "Frontend Development",
  "Backend Development",
  "Databases",
  "Cloud and Infrastructure",
  "DevOps and Deployment",
  "Data Engineering and Analytics",
  "APIs and Integrations",
  "Developer Tools",
  "Other Skills",
];

export function categorizeSkill(skill: Skill): SkillCategory {
  const value = `${skill.category ?? ""} ${skill.name}`.toLocaleLowerCase();

  if (
    /machine learning|artificial intelligence|\bai\b|\bllm|deep learning|nlp|computer vision|tensorflow|pytorch|scikit-learn|xgboost|keras/.test(
      value,
    )
  ) {
    return "Machine Learning and AI";
  }
  if (
    /frontend|front-end|react|vue|angular|next\.js|tailwind|html|css/.test(
      value,
    )
  ) {
    return "Frontend Development";
  }
  if (
    /database|postgres|mysql|mongodb|redis|sqlite|sql\b|dynamodb/.test(value)
  ) {
    return "Databases";
  }
  if (
    /cloud|infrastructure|aws|azure|gcp|google cloud|ec2|firebase|kubernetes/.test(
      value,
    )
  ) {
    return "Cloud and Infrastructure";
  }
  if (
    /devops|deployment|ci\/cd|continuous integration|docker|linux|nginx|prometheus|elk stack/.test(
      value,
    )
  ) {
    return "DevOps and Deployment";
  }
  if (
    /data science|data engineering|analytics|pandas|numpy|spark|airflow|etl|hadoop/.test(
      value,
    )
  ) {
    return "Data Engineering and Analytics";
  }
  if (/backend|back-end|server|fastapi|express|node\.js/.test(value)) {
    return "Backend Development";
  }
  if (/api|integration|graphql|rest|oauth|webhook/.test(value)) {
    return "APIs and Integrations";
  }
  if (
    /programming language|\blanguage\b|python|javascript|typescript|java\b|golang|\bgo\b|ruby|rust|kotlin|swift|php|bash|c\+\+|\bc\b/.test(
      value,
    )
  ) {
    return "Programming Languages";
  }
  if (
    /developer tools|tooling|git|github|vscode|visual studio|postman|jenkins/.test(
      value,
    )
  ) {
    return "Developer Tools";
  }
  return "Other Skills";
}

export function groupSkillsForReview(skills: Skill[]) {
  const groups = new Map<SkillCategory, Skill[]>();
  for (const skill of skills) {
    const category = categorizeSkill(skill);
    groups.set(category, [...(groups.get(category) ?? []), skill]);
  }
  return SKILL_CATEGORY_ORDER.flatMap((category) => {
    const items = groups.get(category);
    return items?.length ? [{ category, skills: items }] : [];
  });
}
