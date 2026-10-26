import { createUnavailableGithubAccess } from "./unavailable";
import type { GithubAccessFactory } from "../ports";

export const createGithubAccess: GithubAccessFactory = () =>
  createUnavailableGithubAccess();
