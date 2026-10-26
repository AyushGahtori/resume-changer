import { err, unavailableError } from "./contracts";
import type { MeasurementPort } from "./ports";

const unavailable = <T>() => err<T>(unavailableError());

export const getApplicableDefinitions: MeasurementPort["getApplicableDefinitions"] =
  () => unavailable();
