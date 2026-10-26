import { err, unavailableError } from "./contracts";
import type { Result } from "./contracts";

export interface MeasurementRecipe {
  id: string;
  version: number;
  title: string;
  guidance: string[];
  neverRunAutomatically: true;
}

/** Gate 0 does not ship sample recipes as achieved results or executable code. */
export function getTrustedMeasurementRecipes(): Result<MeasurementRecipe[]> {
  return err(unavailableError("Measurement recipes are not implemented yet."));
}
