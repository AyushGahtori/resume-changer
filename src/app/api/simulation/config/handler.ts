import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { simulationConfigBody } from "@/lib/simulation/runtime";

export const runtime = "nodejs";

function keyMatches(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const body = simulationConfigBody();
  const expected = process.env.RESUME_SIMULATION_RUNNER_KEY ?? "";
  const provided = request.headers.get("x-simulation-runner-key") ?? "";
  if (!body || !keyMatches(provided, expected)) {
    return NextResponse.json(
      { error: "API route not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      ...body,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
