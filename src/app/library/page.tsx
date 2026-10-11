import Link from "next/link";
import AchievementLibrary from "@/components/achievement-library";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";

type LibraryPageProps = {
  searchParams: Promise<{ source?: string | string[] }>;
};

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const query = await searchParams;
  const source = query.source === "demo" ? "demo" : "personal";

  try {
    const library = await loadResumeLibrary({ source });
    return <AchievementLibrary library={library} source={source} />;
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
