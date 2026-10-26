import { createUnavailableJobStore } from "../unavailable";
import type { JobStoreFactory } from "../../ports";

export const createJobStore: JobStoreFactory = () =>
  createUnavailableJobStore();
