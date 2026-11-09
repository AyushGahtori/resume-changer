export class SavedJobError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "not-found"
      | "locked"
      | "limit"
      | "too-large"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SavedJobError";
  }
}
