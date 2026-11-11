import { NextResponse } from "next/server";
import { loadTestSafetyBody } from "./runtime";

export const runtime = "nodejs";

export async function GET() {
  const body = loadTestSafetyBody();
  if (!body) {
    return NextResponse.json(
      { error: "API route not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
