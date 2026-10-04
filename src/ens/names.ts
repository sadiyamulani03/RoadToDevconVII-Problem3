/**
 * ENS name syntax validation.
 *
 * ENS names discovered from the directory are UNTRUSTED DATA: only well-formed
 * names (at least two labels, lowercase) are ever resolved.
 */

/**
 * Lowercase ENS name with at least two labels, e.g. `contract-agent.example.eth`.
 * Each label: 1–63 chars, alphanumeric with inner hyphens.
 */
export const ENS_NAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/;

export function isValidEnsName(name: string): boolean {
  return ENS_NAME_PATTERN.test(name);
}
