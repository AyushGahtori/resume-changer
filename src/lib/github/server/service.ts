import { createUnavailableImportService } from "./unavailable";
import type { ImportServiceFactory } from "../ports";

export const createImportService: ImportServiceFactory = () =>
  createUnavailableImportService();
