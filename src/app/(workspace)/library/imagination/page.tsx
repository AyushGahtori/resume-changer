import Link from "next/link";
import ImaginationCanvasClient from "./canvas-client";
import { LibraryReadOnlyNotice } from "@/components/library/library-states";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";

type ImaginationPageProps = {
  searchParams: Promise<{ source?: string | string[] }>;
};

export default async function ImaginationPage({
  searchParams,
}: ImaginationPageProps) {
  const query = await searchParams;
  const source = query.source === "demo" ? "demo" : "personal";
  const libraryHref = source === "demo" ? "/library?source=demo" : "/library";

  try {
    const library = await loadResumeLibrary({ source });

    if (source === "demo") {
      return (
        <section className="library-page">
          <header className="library-page-header">
            <div className="library-heading-copy">
              <p className="eyebrow">YOUR EXPERIENCE</p>
              <h1>Imagination Canvas</h1>
              <p className="page-intro">
                Create a new achievement from your saved experience.
              </p>
            </div>
          </header>
          <LibraryReadOnlyNotice />
          <Link className="library-switch-link" href={libraryHref}>
            Back to Achievement library
          </Link>
        </section>
      );
    }

    return <ImaginationCanvasClient library={library} source={source} />;
  } catch (error) {
    const message =
      error instanceof DataLoadError
        ? error.message
        : "The selected library could not be loaded. Check the data file and try again.";
    const alternateSource = source === "personal" ? "demo" : "personal";
    const alternateHref =
      alternateSource === "demo" ? "/library?source=demo" : "/library";

    return (
      <section className="library-error" role="alert">
        <p className="eyebrow">LIBRARY UNAVAILABLE</p>
        <h1>
          Could not load {source === "personal" ? "your" : "demo"} library.
        </h1>
        <p>{message}</p>
        <Link className="library-switch-link" href={alternateHref}>
          Open {alternateSource === "demo" ? "fictional demo data" : "my data"}
        </Link>
      </section>
    );
  }
}
