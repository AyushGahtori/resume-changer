import { notFound } from "next/navigation";
import { ContextInterviewHarness } from "../../../components/github-import/context-interview/testing/harness";
import { isGithubImportHarnessEnabled } from "../../../lib/github/test-harness";
import type { ScriptedRouteLength } from "../../../components/github-import/context-interview/testing/scripted-port";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function routeLength(value: string | undefined): ScriptedRouteLength {
  if (value === "5" || value === "7" || value === "10")
    return Number(value) as 5 | 7 | 10;
  return "adaptive";
}

export default async function GitHubContextInterviewHarnessPage({
  searchParams,
}: PageProps) {
  if (!isGithubImportHarnessEnabled(process.env)) notFound();
  const params = await searchParams;
  const phase = first(params.phase);
  const initialPhase =
    phase === "expired" || phase === "empty" ? phase : "active";

  return (
    <ContextInterviewHarness
      routeLength={routeLength(first(params.route))}
      delayMs={Math.min(5_000, Math.max(0, Number(first(params.slow)) || 0))}
      failCalls={Math.min(3, Math.max(0, Number(first(params.fail)) || 0))}
      dropNextAnswerResponse={first(params.drop) === "1"}
      initialPhase={initialPhase}
    />
  );
}
