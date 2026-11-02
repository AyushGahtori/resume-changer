import { disconnectGithubConnection } from "@/lib/github/server/connection-session";

export const runtime = "nodejs";
export const POST = disconnectGithubConnection;
export const DELETE = disconnectGithubConnection;
