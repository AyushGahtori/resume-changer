import { startGithubConnection } from "@/lib/github/server/connection-session";

export const runtime = "nodejs";
export const POST = startGithubConnection;
