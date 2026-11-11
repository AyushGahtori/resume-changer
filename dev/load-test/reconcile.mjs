export function reconcileMutation(response, observation) {
  if (response === "ok") return "checkpoint";
  if (["conflict", "validation", "auth", "quota"].includes(response))
    return "fail";
  if (observation === "unavailable") return "stop";
  if (observation === "absent") return "retry";
  if (observation === "equal") return "checkpoint";
  return "fail";
}

export function observeLibrary(kind, library, expected) {
  if (!library) return "unavailable";
  if (kind === "profile") {
    const profile = library.profile ?? {};
    const headline = profile.headline ?? "";
    const email = profile.email ?? "";
    if (expected.headline) {
      if (headline === expected.headline) return "equal";
      return headline ? "conflict" : "absent";
    }
    if (
      email === (expected.email ?? "") &&
      headline === (expected.headline ?? "")
    ) {
      return "equal";
    }
    if (email !== (expected.email ?? "")) return "absent";
    return "conflict";
  }
  if (kind === "skills") {
    const have = new Set(
      (library.skills ?? []).map((skill) => skill.name.toLowerCase()),
    );
    const found = expected.names.filter((name) => have.has(name.toLowerCase()));
    if (found.length === expected.names.length) return "equal";
    return found.length === 0 ? "absent" : "conflict";
  }
  if (kind === "job" || kind === "project") {
    const collection = kind === "job" ? library.jobs : library.projects;
    const record = (collection ?? []).find((item) => item.id === expected.id);
    if (!record) return "absent";
    const label = kind === "job" ? (record.company ?? "") : (record.name ?? "");
    return label === (expected.label ?? "") ? "equal" : "conflict";
  }
  if (kind === "point") {
    const points = [
      ...(library.jobs ?? []),
      ...(library.projects ?? []),
    ].flatMap((parent) => parent.points ?? []);
    const point = points.find((item) => item.id === expected.id);
    if (!point) return "absent";
    return point.text === expected.text ? "equal" : "conflict";
  }
  return "conflict";
}

export function classifyHttp(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409) return "conflict";
  if (status === 400 || status === 413) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "quota";
  if (status >= 500) return "uncertain";
  return "fail";
}
