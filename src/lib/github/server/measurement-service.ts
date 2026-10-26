import { createUnavailableMeasurementService } from "./unavailable";
import type { MeasurementServiceFactory } from "../ports";

export const createMeasurementService: MeasurementServiceFactory = () =>
  createUnavailableMeasurementService();
