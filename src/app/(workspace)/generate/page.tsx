import Link from "next/link";
import ResumeGenerator from "@/components/resume-generator";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";

type GeneratePageProps = {
  searchParams: Promise<{ source?: string | string[] }>;
};

export default async function GeneratePage({
  searchParams,
}: GeneratePageProps) {
  const query = await searchParams;
  const source = query.source === "demo" ? "demo" : "personal";

  try {
    const library = await loadResumeLibrary({ source });
    /*
     * The builder's selections, analysis, tailoring, and output belong to the
     * library that produced them. A source-link navigation can preserve the
     * route segment's React tree, so key the workflow by source to discard
     * state that would otherwise be carried into a different library.
     */
    return <ResumeGenerator key={source} library={library} source={source} />;
  } catch (error) {
    const message =
      error instanceof DataLoadError
        ? error.message
        : "The selected resume data could not be loaded.";
    const alternateSource = source === "personal" ? "demo" : "personal";
    const alternateHref =
      alternateSource === "demo" ? "/generate?source=demo" : "/generate";

    return (
      <section className="generation-error" role="alert">
        <p className="eyebrow">RESUME DATA UNAVAILABLE</p>
        <h1>Resume builder</h1>
        <p>{message}</p>
        <Link className="library-switch-link" href={alternateHref}>
          Open {alternateSource === "demo" ? "fictional demo data" : "my data"}
        </Link>
      </section>
    );
  }
}
