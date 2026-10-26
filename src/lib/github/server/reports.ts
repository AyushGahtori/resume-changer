import { createUnavailableReportParser } from "./unavailable";
import type { ReportParserPort } from "../ports";

export const createReportParser: () => ReportParserPort =
  createUnavailableReportParser;
