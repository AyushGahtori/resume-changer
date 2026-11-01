import { notFound } from "next/navigation";
import { ContextEvidenceHarness } from "../../../components/github-import/context-evidence-ui/testing/harness";
import { isGithubImportHarnessEnabled } from "../../../lib/github/test-harness";

export const dynamic = "force-dynamic";

export default function GithubContextEvidenceHarnessPage() {
  if (!isGithubImportHarnessEnabled(process.env)) notFound();
  return <ContextEvidenceHarness />;
}
