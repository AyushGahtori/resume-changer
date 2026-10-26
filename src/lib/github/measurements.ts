import { err, unavailableError } from "./contracts";
import type { MeasurementAnswer, MeasurementResult, Result } from "./contracts";
import type { MeasurementPort } from "./ports";

const unavailable = <T>() => err<T>(unavailableError());

export const validateMeasurementAnswer: MeasurementPort["validateMeasurementAnswer"] =
  () => unavailable();
export const deriveMeasurementResult: MeasurementPort["deriveMeasurementResult"] =
  () => unavailable();
export const renderMetricClause: MeasurementPort["renderMetricClause"] = () =>
  unavailable();

export type { MeasurementAnswer, MeasurementResult, Result };
