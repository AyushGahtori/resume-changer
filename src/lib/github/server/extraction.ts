import { createUnavailableRepositoryExtractor } from "./unavailable";
import type { RepositoryExtractorFactory } from "../ports";

export const createRepositoryExtractor: RepositoryExtractorFactory = () =>
  createUnavailableRepositoryExtractor();
