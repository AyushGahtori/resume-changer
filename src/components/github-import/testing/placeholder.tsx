export function GithubImportComponentPlaceholder({ name }: { name: string }) {
  return (
    <section
      role="status"
      data-testid="github-import-placeholder"
      data-component={name}
    >
      <h2>{name}</h2>
      <p>This GitHub import component is not implemented yet.</p>
    </section>
  );
}
