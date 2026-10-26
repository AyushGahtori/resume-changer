import { createUnavailableEvidenceSelector } from "./unavailable";
import type { EvidenceSelectorFactory } from "../ports";

export const createEvidenceSelector: EvidenceSelectorFactory = () =>
  createUnavailableEvidenceSelector();
