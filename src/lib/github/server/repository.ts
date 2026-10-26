import { createUnavailableRepositoryInspector } from "./unavailable";
import type { RepositoryInspectorFactory } from "../ports";

export const createRepositoryInspector: RepositoryInspectorFactory = () =>
  createUnavailableRepositoryInspector();
