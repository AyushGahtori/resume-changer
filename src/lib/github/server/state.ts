import * as local from "./local-state";

export interface DurableStateStorage {
  readonly kind: "durable";
  assertPath(root: string, target: string): Promise<void>;
  read(root: string, target: string, maxBytes: number): Promise<string>;
  write(root: string, target: string, text: string): Promise<void>;
  withLock<T>(
    root: string,
    target: string,
    work: () => Promise<T>,
    maxWaitMs?: number,
  ): Promise<T>;
}

let storage: DurableStateStorage | undefined;
export function configureDurableStateStorage(next: DurableStateStorage) {
  if (storage && storage !== next)
    throw new Error("Durable GitHub state is already configured.");
  storage = next;
}
export function hasDurableStateStorage() {
  return storage?.kind === "durable";
}
function requireHostedStorage() {
  if (process.env.VERCEL === "1" && !storage)
    throw new Error("Durable GitHub state is not configured.");
  return storage;
}
export async function assertStatePath(root: string, target: string) {
  const hosted = requireHostedStorage();
  return hosted
    ? hosted.assertPath(root, target)
    : local.assertLocalStatePath(root, target);
}
export async function readState(
  root: string,
  target: string,
  maxBytes: number,
) {
  const hosted = requireHostedStorage();
  return hosted
    ? hosted.read(root, target, maxBytes)
    : local.readLocalState(root, target, maxBytes);
}
export async function writeState(
  root: string,
  target: string,
  text: string,
  renameFile?: Parameters<typeof local.writeLocalState>[3],
) {
  const hosted = requireHostedStorage();
  if (hosted && renameFile)
    throw new Error("Hosted state cannot use a filesystem rename adapter.");
  return hosted
    ? hosted.write(root, target, text)
    : local.writeLocalState(root, target, text, renameFile);
}
export async function withStateLock<T>(
  root: string,
  target: string,
  work: () => Promise<T>,
  maxWaitMs?: number,
) {
  const hosted = requireHostedStorage();
  return hosted
    ? hosted.withLock(root, target, work, maxWaitMs)
    : local.withLocalStateLock(root, target, work, maxWaitMs);
}
