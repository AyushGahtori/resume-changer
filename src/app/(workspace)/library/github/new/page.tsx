import Link from "next/link";
import { githubInstallationUrl } from "../../../../../lib/github/installation-url";
import { ImportWorkspace } from "../../../../../components/github-import/import-workspace";
import {
  DataLoadError,
  loadResumeLibrary,
} from "../../../../../lib/data/loaders";

type NewGithubImportPageProps = {
  searchParams: Promise<{
    source?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function NewGithubImportPage({
  searchParams,
}: NewGithubImportPageProps) {
  const query = await searchParams;
  const source = query.source === "demo" ? "demo" : "personal";

  try {
    const library = await loadResumeLibrary({ source });
    const projects = library.projects.map((project) => ({
      id: project.id,
      name: project.name,
    }));
    return (
      <ImportWorkspace
        source={source}
        importId={null}
        routeState="setup"
        initialState={null}
        installationUrl={
          source === "personal"
            ? githubInstallationUrl(process.env.GITHUB_APP_SLUG)
            : undefined
        }
        projects={projects}
        initialProjectId={projects.find((p) => p.id === query.projectId)?.id}
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
        <Link href={source === "demo" ? "/library?source=demo" : "/library"}>
          Return to the library
        </Link>
      </section>
    );
  }
}
