import { notFound } from "next/navigation";
import { isSimulationRuntime } from "@/lib/simulation/runtime";
import SimulationSignInClient from "./simulation-sign-in-client";

export default function SimulationSignInPage() {
  if (!isSimulationRuntime()) notFound();
  return <SimulationSignInClient />;
}
