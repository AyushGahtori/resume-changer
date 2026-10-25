function same(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/** Keep administrative access in the operator's CLI, never in the web app. */
export async function syncAuthDomains(
  { project, configuredProject, domains, apply = false },
  api,
) {
  if (!project || project !== configuredProject)
    throw new Error("The requested project does not match .firebaserc.");
  if (
    !Array.isArray(domains) ||
    !domains.length ||
    domains.length > 10 ||
    new Set(domains).size !== domains.length ||
    domains.some(
      (domain) =>
        typeof domain !== "string" ||
        domain.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
        !domain.includes(".") ||
        domain.includes(".."),
    )
  )
    throw new Error(
      "Configure exact DNS hostnames without protocols, ports or wildcards.",
    );
  const before = await api.getAuthDomains(project);
  if (same(before, domains))
    return { project, domains, changed: false, verified: true };
  if (!apply)
    throw new Error(
      "Firebase's authorized domains differ from firebase.json. Review the list, then run this command with --apply.",
    );
  await api.updateAuthDomains(project, domains);
  const after = await api.getAuthDomains(project);
  if (!same(after, domains))
    throw new Error(
      "Firebase authorized-domain read-back did not match the requested configuration.",
    );
  return { project, domains: after, changed: true, verified: true };
}
