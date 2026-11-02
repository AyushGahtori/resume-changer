import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import WorkspaceShell from "@/components/workspace-shell";
import { isGithubImportRuntimeConfigured } from "@/lib/github/server/composition";
import {
  AccountSession,
  type WorkspaceAccount,
} from "@/components/account-session";
import { AccountAccessError, getAppMode } from "@/lib/cloud/security";
import { requireCloudAccount } from "@/lib/cloud/server-account";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  let account: WorkspaceAccount | null = null;
  if (getAppMode() === "firebase") {
    try {
      const current = await requireCloudAccount();
      account = {
        uid: current.uid,
        email: current.email,
        displayName: current.displayName,
      };
    } catch (error) {
      if (error instanceof AccountAccessError && error.status === 401)
        redirect("/sign-in");
      throw error;
    }
  }
  return (
    <AccountSession account={account}>
      <WorkspaceShell
        githubImportsAvailable={isGithubImportRuntimeConfigured()}
      >
        {children}
      </WorkspaceShell>
    </AccountSession>
  );
}
