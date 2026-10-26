import { createUnavailableGithubClient } from "./unavailable";
import type { GithubClientFactory } from "../ports";

export const createGithubClient: GithubClientFactory = () =>
  createUnavailableGithubClient();
