import { createUnavailableGithubServices } from "./unavailable";
import type { GithubServices } from "../ports";

export function createGithubServices(): GithubServices {
  return createUnavailableGithubServices();
}
