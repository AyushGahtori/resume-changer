import { createUnavailableSelectionPolicy } from "./unavailable";
import type { SelectionPolicyFactory } from "../ports";

export const createSelectionPolicy: SelectionPolicyFactory = () =>
  createUnavailableSelectionPolicy();
