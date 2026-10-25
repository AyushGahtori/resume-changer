"use client";

import { useState } from "react";
import { Download, FileUp, FolderLock } from "lucide-react";
import { useWorkspaceAccount } from "./account-session";
import { apiFetch } from "@/lib/cloud/api-fetch";
import { validateCloudLibrary } from "@/lib/cloud/library-contract";
import { GenerationHistoryEntrySchema } from "@/lib/schemas/resume-data";
import { z } from "zod";

const BackupSchema = z.object({
  schemaVersion: z.literal(1),
  targetEmail: z.email(),
  library: z.unknown(),
  history: z
    .array(
      z.object({
        entry: z.unknown(),
        latex: z.string().max(150_000),
        pdfBase64: z.string().max(3_000_000).optional(),
        latexSha256: z.string(),
        pdfSha256: z.string().optional(),
      }),
    )
    .max(1000),
  manifest: z.unknown(),
});

async function digest(value: string | Uint8Array) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function AccountDataTools() {
  const account = useWorkspaceAccount();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [checkingPdf, setCheckingPdf] = useState(false);
  const [pdfNotice, setPdfNotice] = useState("");
  if (!account) return null;

  async function checkPdfService() {
    setCheckingPdf(true);
    setPdfNotice("");
    try {
      const response = await apiFetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkService: true }),
      });
      const result = await response.json();
      if (!response.ok || !result.ready || result.pageCount !== 1)
        throw new Error(
          result.error ?? "The PDF service check could not finish.",
        );
      setPdfNotice(
        "PDF service ready. A one-page sample compiled successfully; your saved resumes were unchanged.",
      );
    } catch (reason) {
      setPdfNotice(
        reason instanceof Error
          ? reason.message
          : "The PDF service is temporarily unavailable.",
      );
    } finally {
      setCheckingPdf(false);
    }
  }

  async function importFile() {
    if (!file || !account) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 50 MB.");
      const raw: unknown = JSON.parse(await file.text());
      const backup = BackupSchema.safeParse(raw);
      if (
        backup.success &&
        backup.data.targetEmail.toLowerCase() !== account.email.toLowerCase()
      )
        throw new Error(
          "This backup belongs to a different account. Sign in with its destination email first.",
        );
      const library = validateCloudLibrary(
        backup.success ? backup.data.library : raw,
      );
      const targetEmail = backup.success
        ? backup.data.targetEmail
        : account.email;
      const response = await apiFetch("/api/account/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library, replace, targetEmail }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Your library could not be imported.");
      const readBack = await apiFetch("/api/account/library", {
        cache: "no-store",
      });
      if (
        !readBack.ok ||
        (await digest(JSON.stringify((await readBack.json()).library))) !==
          (await digest(JSON.stringify(library)))
      )
        throw new Error(
          "The imported library could not be verified. Your local backup is unchanged.",
        );
      let imported = 0;
      if (backup.success)
        for (const item of backup.data.history) {
          const entry = GenerationHistoryEntrySchema.parse(item.entry);
          if ((await digest(item.latex)) !== item.latexSha256)
            throw new Error(
              "A LaTeX file in the backup failed its integrity check.",
            );
          if (item.pdfBase64) {
            const bytes = Uint8Array.from(atob(item.pdfBase64), (character) =>
              character.charCodeAt(0),
            );
            if ((await digest(bytes)) !== item.pdfSha256)
              throw new Error(
                "A PDF in the backup failed its integrity check.",
              );
          }
          const { texPath: _texPath, pdfPath: _pdfPath, ...metadata } = entry;
          const saved = await apiFetch("/api/account/import/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targetEmail,
              generation: {
                ...metadata,
                latex: item.latex,
                ...(item.pdfBase64 ? { pdfBase64: item.pdfBase64 } : {}),
              },
            }),
          });
          const payload = await saved.json();
          if (!saved.ok || payload.entry?.id !== entry.id)
            throw new Error(
              payload.error ??
                "A saved resume could not be imported. You can retry this backup safely.",
            );
          const verified = await apiFetch(
            `/api/history/${encodeURIComponent(entry.id)}`,
            { cache: "no-store" },
          );
          const restored = await verified.json();
          if (
            !verified.ok ||
            (await digest(restored.latex ?? "")) !== item.latexSha256 ||
            JSON.stringify(restored.entry) !== JSON.stringify(payload.entry)
          )
            throw new Error(
              "A saved resume failed authenticated read-back verification. Your local backup is unchanged.",
            );
          if (item.pdfBase64) {
            const downloaded = await apiFetch(
              `/api/history/${encodeURIComponent(entry.id)}/pdf`,
              { cache: "no-store" },
            );
            if (
              !downloaded.ok ||
              (await digest(new Uint8Array(await downloaded.arrayBuffer()))) !==
                item.pdfSha256
            )
              throw new Error(
                "A saved PDF failed authenticated read-back verification. Your local backup is unchanged.",
              );
          }
          imported += 1;
          setNotice(
            `Library verified. Imported ${imported} of ${backup.data.history.length} saved resumes…`,
          );
        }
      setNotice(
        `Your library is imported and verified${imported ? `, with ${imported} saved resumes` : ""}. Open your library to continue.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The import could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportLibrary() {
    setError("");
    try {
      const response = await apiFetch("/api/account/library", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Your library could not be exported.");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload.library, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "resume-library.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Your library could not be exported. Please try again.");
    }
  }

  return (
    <section
      className="account-data-panel"
      aria-labelledby="account-data-title"
    >
      <span className="account-data-icon">
        <FolderLock aria-hidden="true" size={24} />
      </span>
      <div>
        <p className="eyebrow">Your own space</p>
        <h2 id="account-data-title">Bring your achievements along.</h2>
        <p>
          Import an existing library or account backup. It is saved only to{" "}
          <strong>{account.email}</strong>.
        </p>
        <label className="account-import-file">
          Library or backup file
          <input
            accept="application/json,.json"
            type="file"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setNotice("");
              setError("");
            }}
          />
        </label>
        <label className="account-import-confirm">
          <input
            type="checkbox"
            checked={replace}
            disabled={busy}
            onChange={(event) => setReplace(event.target.checked)}
          />
          Replace my existing library. I have saved a backup.
        </label>
        <div className="account-data-actions">
          <button disabled={!file || busy} type="button" onClick={importFile}>
            <FileUp aria-hidden="true" size={17} />
            {busy ? "Importing…" : "Import to my account"}
          </button>
          <button disabled={busy} type="button" onClick={exportLibrary}>
            <Download aria-hidden="true" size={17} />
            Export my library
          </button>
          <button
            disabled={busy || checkingPdf}
            type="button"
            onClick={checkPdfService}
          >
            {checkingPdf ? "Checking PDF service…" : "Check PDF service"}
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
        {pdfNotice && <p role="status">{pdfNotice}</p>}
        {error && (
          <p role="alert" className="account-entry-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
