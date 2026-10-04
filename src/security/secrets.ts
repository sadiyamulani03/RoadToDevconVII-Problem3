/**
 * Central environment / secret handling — SECURITY BOUNDARY (challenge CHECK 9).
 *
 * Values produced here (LLM_API_KEY, DEPLOYER_PRIVATE_KEY, ...) are SECRETS:
 * they must never be logged, embedded in error messages, or written to
 * telemetry. Callers pass them ONLY into Authorization headers / transaction
 * signing. In particular, environment variables must NEVER contain agent
 * endpoint URLs — those come exclusively from validated ENS records.
 */

/** Read a required environment variable, or throw a clear configuration error. */
export function readRequiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill in the values.`,
    );
  }
  return value;
}

/** Read an optional environment variable (trimmed; empty string becomes undefined). */
export function readOptionalEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * True for obviously non-secret placeholder values.
 * Used to verify that .env.example contains placeholders only (CHECK 9).
 */
export function isPlaceholderValue(value: string): boolean {
  return /your|changeme|placeholder|here|<|example|fixme|todo/i.test(value);
}

/**
 * Log-injection defense: strip control characters (so untrusted text can not
 * forge log lines) and truncate. Use this for EVERY untrusted string that is
 * written to logs, error details, or telemetry.
 */
export function safeTruncate(value: string, maxLength: number): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Describe an unknown thrown value safely (never leaks secrets, one line only). */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return safeTruncate(cause.message, 300);
  }
  return safeTruncate(String(cause), 300);
}
