import { createUnavailablePrContextReader } from "./unavailable";
import type { PrContextReaderFactory } from "../ports";

export const createPrContextReader: PrContextReaderFactory = () =>
  createUnavailablePrContextReader();
