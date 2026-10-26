import { createUnavailableGithubServices } from "./unavailable";
import type { GithubServices } from "../ports";

export function getGithubServices(): GithubServices {
  return createUnavailableGithubServices();
}
