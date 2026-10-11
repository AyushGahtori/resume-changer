import type { Metadata } from "next";
import type { ReactNode } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Changer",
  description:
    "A local-first workspace for tailoring a resume to a job description.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <WorkspaceShell>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
