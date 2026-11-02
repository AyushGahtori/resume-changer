import Link from "next/link";
import { githubInstallationUrl } from "../../../../../lib/github/installation-url";
import { notFound } from "next/navigation";
import { ImportWorkspace } from "../../../../../components/github-import/import-workspace";
import {
  DataLoadError,
  loadResumeLibrary,
} from "../../../../../lib/data/loaders";

type GithubImportPageProps = {
  params: Promise<{ importId: string }>;
};

export default async function GithubImportPage({
  params,
}: GithubImportPageProps) {
  const { importId } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(importId)) notFound();
  const source = "personal" as const;

  try {
    const library = await loadResumeLibrary({ source });
    const projects = library.projects.map((project) => ({
      id: project.id,
      name: project.name,
    }));
    return (
      <ImportWorkspace
        source={source}
        importId={importId}
        routeState="analysis"
        initialState={null}
        installationUrl={githubInstallationUrl(process.env.GITHUB_APP_SLUG)}
        projects={projects}
      />
    );
  } catch (error) {
    const message =
      error instanceof DataLoadError
        ? error.message
        : "The selected library could not be loaded. Check the data file and try again.";
    return (
      <section role="alert">
        <p className="eyebrow">LIBRARY UNAVAILABLE</p>
        <h1>Could not load the destination library.</h1>
        <p>{message}</p>
        <Link href="/library">Return to the library</Link>
      </section>
    );
  }
}
