export type JsoncParseResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid-jsonc" | "unsafe-key" };

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function parseJsonc(text: string): JsoncParseResult {
  const withoutComments = removeComments(text);
  if (withoutComments === null) return { ok: false, reason: "invalid-jsonc" };
  const withoutTrailingCommas = removeTrailingCommas(withoutComments);
  let value: unknown;
  try {
    value = JSON.parse(withoutTrailingCommas) as unknown;
  } catch {
    return { ok: false, reason: "invalid-jsonc" };
  }
  return containsForbiddenKey(value)
    ? { ok: false, reason: "unsafe-key" }
    : { ok: true, value };
}

function removeComments(text: string): string | null {
  let result = "";
  let inString = false;
  let escaped = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (inString) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      continue;
    }
    if (current === "/" && next === "/") {
      result += "  ";
      index += 1;
      while (index + 1 < text.length && text[index + 1] !== "\n") {
        index += 1;
        result += " ";
      }
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      index += 1;
      while (index + 1 < text.length) {
        index += 1;
        const commentCharacter = text[index] ?? "";
        if (commentCharacter === "*" && text[index + 1] === "/") {
          index += 1;
          result += "  ";
          inBlockComment = false;
          break;
        }
        result += commentCharacter === "\n" ? "\n" : " ";
      }
      continue;
    }
    result += current;
  }
  return inBlockComment ? null : result;
}

function removeTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index] ?? "";
    if (inString) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      result += current;
      continue;
    }
    if (current === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(text[lookahead] ?? "")) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") continue;
    }
    result += current;
  }
  return result;
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child)) return true;
  }
  return false;
}
