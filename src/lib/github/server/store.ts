import {
  createUnavailableDeferredMeasurementTaskStore,
  createUnavailableImportStore,
} from "./unavailable";
import type {
  DeferredMeasurementTaskStoreFactory,
  ImportStoreFactory,
} from "../ports";

export const createImportStore: ImportStoreFactory = () =>
  createUnavailableImportStore();

export const createDeferredMeasurementTaskStore: DeferredMeasurementTaskStoreFactory =
  () => createUnavailableDeferredMeasurementTaskStore();
