import { applyJakeStyleTemplate } from "../latex/jake-template";

/** A fixed fictional document: readiness checks must not load personal records. */
export function buildPdfServiceCheckLatex(): string {
  return applyJakeStyleTemplate(String.raw`\ResumeHeader{PDF service check}{Fictional sample for service verification}
\section*{Experience}
\ResumeEntry{Sample Engineer}{2024 -- Present}{Example Systems}{Remote}
\ResumeBulletListStart
\item Compiled a fictional document to verify the hosted PDF service without changing saved resumes.
\ResumeBulletListEnd
`);
}
