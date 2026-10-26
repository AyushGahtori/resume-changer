import { err, unavailableError } from "../contracts";
import type { Result } from "../contracts";

export function migrateGithubLibrary(): Result<never> {
  return err(
    unavailableError("GitHub library migration is not implemented yet."),
  );
}
