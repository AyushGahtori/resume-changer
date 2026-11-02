export function githubRuntimeIamBindings(project, database, email) {
  if (
    !/^[a-z][a-z0-9-]{5,62}$/.test(project) ||
    !/^\(?[a-z][a-z0-9-]{2,62}\)?$/.test(database) ||
    email !== `github-phase-one@${project}.iam.gserviceaccount.com`
  )
    throw new Error("Unexpected hosted runtime identity.");
  const member = `serviceAccount:${email}`;
  return [
    {
      role: "roles/datastore.user",
      members: [member],
      condition: {
        title: "github-phase-one-database",
        description: "Only the approved account database.",
        expression: `resource.name == "projects/${project}/databases/${database}"`,
      },
    },
    {
      role: `projects/${project}/roles/githubPreviewAuthRead`,
      members: [member],
    },
  ];
}
