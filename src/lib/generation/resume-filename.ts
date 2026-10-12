export function createResumeFilename(company: string, roleTitle: string) {
  const slug = [company, roleTitle]
    .map((value) =>
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(Boolean)
    .join("-");
  return `${slug || "resume"}.tex`;
}
