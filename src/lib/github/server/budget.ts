import { createUnavailableBudgetLedger } from "./unavailable";
import type { BudgetLedgerFactory } from "../ports";

export const createBudgetLedger: BudgetLedgerFactory = () =>
  createUnavailableBudgetLedger();
