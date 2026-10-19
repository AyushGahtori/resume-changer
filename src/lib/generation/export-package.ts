import { validateResumeLatex } from "../latex/validate-resume-latex";
import type { ManualGenerationResult } from "./manual-generation";
import { createResumeFilename } from "./resume-filename";

type ExportFile = { name: string; bytes: Uint8Array };

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: ExportFile[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const directoryParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, file.bytes);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, file.bytes.length, true);
    directoryView.setUint32(24, file.bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    directoryParts.push(directory);
    offset += local.length + file.bytes.length;
  }

  const directorySize = directoryParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const archiveLength = offset + directorySize + end.length;
  const archiveBuffer = new ArrayBuffer(archiveLength);
  const archive = new Uint8Array(archiveBuffer);
  let archiveOffset = 0;
  for (const part of [...localParts, ...directoryParts, end]) {
    archive.set(part, archiveOffset);
    archiveOffset += part.length;
  }
  return new Blob([archiveBuffer], { type: "application/zip" });
}

export function createResumeExportPackage(
  generation: ManualGenerationResult,
  pdfBase64: string | null,
): { filename: string; blob: Blob; includedPdf: boolean } {
  const { metadata, latex } = generation;
  const latexName = createResumeFilename(metadata.company, metadata.roleTitle);
  const pdfName = latexName.replace(/\.tex$/, ".pdf");
  const metadataName = latexName.replace(/\.tex$/, ".metadata.json");
  const validation = validateResumeLatex(latex);
  let pdfBytes: Uint8Array | undefined;
  if (pdfBase64) {
    try {
      const binary = atob(pdfBase64);
      const candidate = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      if (new TextDecoder().decode(candidate.slice(0, 5)) === "%PDF-")
        pdfBytes = candidate;
    } catch {
      pdfBytes = undefined;
    }
  }

  const exportedMetadata = {
    schemaVersion: 1,
    generation: {
      id: metadata.id,
      generatedAt: metadata.generatedAt,
      company: metadata.company,
      roleTitle: metadata.roleTitle,
      tailoringMode: metadata.tailoringMode,
      selectedAchievementIds: metadata.selectedAchievementIds,
      aiProvider: metadata.aiProvider ?? null,
    },
    validation: {
      latex: validation.valid ? "valid" : "invalid",
      validationErrors: validation.errors,
      pdf: pdfBytes ? "verified" : "not-generated",
      pdfPages: pdfBytes ? 1 : null,
      repairAttempts: metadata.fitting?.repairAttempts ?? 0,
      fittingStatus: metadata.fitting?.status ?? "not-recorded",
      fittingAttempts: metadata.fitting?.attempts ?? 0,
    },
    files: [latexName, ...(pdfBytes ? [pdfName] : []), metadataName],
  };
  const files: ExportFile[] = [
    { name: latexName, bytes: toBytes(latex) },
    ...(pdfBytes ? [{ name: pdfName, bytes: pdfBytes }] : []),
    {
      name: metadataName,
      bytes: toBytes(JSON.stringify(exportedMetadata, null, 2)),
    },
  ];

  return {
    filename: latexName.replace(/\.tex$/, ".zip"),
    blob: zipStored(files),
    includedPdf: Boolean(pdfBytes),
  };
}
