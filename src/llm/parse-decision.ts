/**
 * Parse the raw LLM output into a structured {@link RoutingDecision}.
 *
 * SECURITY: the parsed value is the ONLY thing the application reads from the
 * model. Unknown fields are stripped by the schema (a "url" emitted by the
 * model can never be used), and the membership constraint is enforced
 * separately in validateRoutingDecision() (challenge CHECK 1).
 */
import { safeTruncate } from '../security/secrets.js';
import { summarizeIssues } from '../validation.js';
import { RoutingDecisionSchema, type RoutingDecision } from './schema.js';

export class InvalidLlmOutputError extends Error {
  public override readonly name = 'InvalidLlmOutputError';
}

/**
 * Extract the first balanced JSON object from a raw string (defensive against
 * models that wrap JSON in prose or code fences). The extracted value is still
 * fully Zod-validated afterwards.
 */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === undefined) {
      break;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  return null;
}

/** Normalize a model-provided agent id (trim + lowercase) before validation. */
function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Parse raw LLM text into a RoutingDecision.
 * Throws {@link InvalidLlmOutputError} when the output is not a valid
 * `{"agentId": ...}` decision.
 */
export function parseRoutingDecision(raw: string): RoutingDecision {
  const candidate = extractFirstJsonObject(raw);

  let json: unknown;
  try {
    json = JSON.parse(candidate ?? raw);
  } catch (cause) {
    throw new InvalidLlmOutputError(
      `Routing model output is not valid JSON: ${safeTruncate(raw, 200)}`,
    );
  }

  const parsed = RoutingDecisionSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidLlmOutputError(
      `Routing model output failed decision schema validation: ${summarizeIssues(parsed.error)}`,
    );
  }

  const agentId = parsed.data.agentId === null ? null : normalizeAgentId(parsed.data.agentId);
  return { agentId };
}
