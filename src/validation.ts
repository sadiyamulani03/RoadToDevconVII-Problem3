/** Shared Zod helpers. */

/** Human-readable one-line summary of Zod issues (for safe error messages). */
export function summarizeIssues(error: { issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }> }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
