import { requireSafeUid } from "./security";

export function accountStorage(storage: Storage, uid: string): Storage {
  const prefix = `resume-changer.account.${requireSafeUid(uid)}.`;
  const keys = () =>
    Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    ).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  return {
    get length() {
      return keys().length;
    },
    key(index) {
      return keys()[index]?.slice(prefix.length) ?? null;
    },
    getItem(key) {
      return storage.getItem(`${prefix}${key}`);
    },
    setItem(key, value) {
      storage.setItem(`${prefix}${key}`, value);
    },
    removeItem(key) {
      storage.removeItem(`${prefix}${key}`);
    },
    clear() {
      for (const key of keys()) storage.removeItem(key);
    },
  };
}
