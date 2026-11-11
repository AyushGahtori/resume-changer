import { notFound } from "next/navigation";
import { isLoadTestRuntime } from "@/lib/load-test/runtime";
import LoadTestAuthClient from "./load-test-auth-client";

export const dynamic = "force-dynamic";

export default function LoadTestAuthPage() {
  if (!isLoadTestRuntime()) notFound();
  return <LoadTestAuthClient />;
}
