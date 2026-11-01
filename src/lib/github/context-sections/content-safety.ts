const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\s*[:=]\s*["']?([A-Za-z0-9/+_.=-]{28,})/i,
];

const UNTRUSTED_INSTRUCTION_PATTERN =
  /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|system|developer|safety)\s+instructions|(?:reveal|print|exfiltrate)\s+(?:the\s+)?(?:system prompt|credentials|secrets)|do not follow (?:the )?(?:system|developer) instructions/i;

export interface ContentSafetyAssessment {
  safe: boolean;
  reason?: "secret-content" | "binary-content";
  untrustedInstructions: boolean;
  plannedDocumentation: boolean;
}

/** Screens the complete bounded text before any section is exposed. */
export function inspectBoundedText(
  text: string,
  path: string,
): ContentSafetyAssessment {
  if (text.includes("\u0000") || hasBinaryControls(text)) {
    return {
      safe: false,
      reason: "binary-content",
      untrustedInstructions: false,
      plannedDocumentation: false,
    };
  }

  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      safe: false,
      reason: "secret-content",
      untrustedInstructions: false,
      plannedDocumentation: false,
    };
  }

  const isDocumentation = /\.(?:md|mdx|rst|adoc|txt)$/i.test(path);
  return {
    safe: true,
    untrustedInstructions: UNTRUSTED_INSTRUCTION_PATTERN.test(text),
    plannedDocumentation:
      isDocumentation &&
      /\b(?:planned|will be implemented|not yet implemented|future work|roadmap)\b/i.test(
        text,
      ),
  };
}

function hasBinaryControls(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (
      (code < 0x20 &&
        code !== 0x09 &&
        code !== 0x0a &&
        code !== 0x0c &&
        code !== 0x0d) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}
