import { createUnavailableImportJobRunner } from "../unavailable";
import type { ImportJobRunnerFactory } from "../../ports";

export const createImportJobRunner: ImportJobRunnerFactory = () =>
  createUnavailableImportJobRunner();
