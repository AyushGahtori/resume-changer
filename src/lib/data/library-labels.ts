/** Visible stand-ins. These strings are never stored or sent as evidence. */

export function profileDisplayName(fullName: string) {
  return fullName.trim() || "Your profile";
}

export function jobDisplayTitle(title: string) {
  return title.trim() || "Untitled job";
}

export function projectDisplayName(name: string) {
  return name.trim() || "Untitled project";
}

export function jobFilterLabel(job: { title: string; company: string }) {
  const title = jobDisplayTitle(job.title);
  const company = job.company.trim();
  return company ? `${title} · ${company}` : title;
}

export function projectFilterLabel(project: { name: string; role?: string }) {
  const name = projectDisplayName(project.name);
  const role = project.role?.trim();
  return role ? `${name} · ${role}` : name;
}
