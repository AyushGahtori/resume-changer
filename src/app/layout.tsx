import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./account.css";

export const metadata: Metadata = {
  title: "Resume Changer",
  description:
    "A private workspace for tailoring your resume to each opportunity.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
