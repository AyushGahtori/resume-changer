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
    return <ResumeGenerator library={library} source={source} />;
  } catch (error) {
    const missingPersonalLibrary =
      source === "personal" &&
      error instanceof DataLoadError &&
      error.code === "missing-file";
    const message =
      error instanceof DataLoadError
        ? error.message
        : "The selected resume data could not be loaded.";
    const alternateSource = source === "personal" ? "demo" : "personal";
    const alternateHref =
      alternateSource === "demo" ? "/generate?source=demo" : "/generate";

    return (
      <section className="generation-error" role="alert">
        <p className="eyebrow">
          {missingPersonalLibrary
            ? "PERSONAL DATA NOT SET UP"
            : "RESUME DATA UNAVAILABLE"}
        </p>
        <h1>
          {missingPersonalLibrary
            ? "Set up your resume data"
            : "Resume builder"}
        </h1>
        <p>
          {missingPersonalLibrary
            ? "There is no personal resume library in this checkout yet. Explore the builder with fictional demo data, or add your private data file to use your own resume information."
            : message}
        </p>
        {missingPersonalLibrary && (
          <p className="generation-error-setup">
            Your private file belongs at <code>data/resume-library.json</code>.
            You can also set <code>RESUME_LIBRARY_ROOT</code> to the folder
            containing its <code>data</code> directory.
          </p>
        )}
        <Link
          className="primary-button library-switch-link"
          href={alternateHref}
        >
          {alternateSource === "demo"
            ? "Open fictional demo data"
            : "Open my data"}
        </Link>
      </section>
    );
  }
}
