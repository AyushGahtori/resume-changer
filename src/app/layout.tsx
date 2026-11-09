import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import "./account.css";

const themeBootScript =
  '(function(){try{var theme=localStorage.getItem("resume-changer.theme.v1");document.documentElement.setAttribute("data-theme",theme==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})();';

export const metadata: Metadata = {
  title: "Resume Changer",
  description:
    "A private workspace for tailoring your resume to each opportunity.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
