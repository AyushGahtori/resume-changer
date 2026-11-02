import { notFound } from "next/navigation";
import { ImportComponentHarness } from "../../../components/github-import/testing/harness";
import { isGithubImportHarnessEnabled } from "../../../lib/github/test-harness";

export const dynamic = "force-dynamic";

export default function GithubImportHarnessPage() {
  if (!isGithubImportHarnessEnabled(process.env)) notFound();
  return <ImportComponentHarness />;
}
