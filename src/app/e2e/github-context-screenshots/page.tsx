import { notFound } from "next/navigation";
import { ContextScreenshotsHarness } from "../../../components/github-import/context-screenshots/testing/harness";
import { isGithubImportHarnessEnabled } from "../../../lib/github/test-harness";

export const dynamic = "force-dynamic";

export default function GithubContextScreenshotsHarnessPage() {
  if (!isGithubImportHarnessEnabled(process.env)) notFound();
  return <ContextScreenshotsHarness />;
}
