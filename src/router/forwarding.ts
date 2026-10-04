/**
 * DOWNSTREAM FORWARDING (challenge CHECK 2 + CHECK 5).
 *
 * SECURITY BOUNDARY (CHECK 2): the ONLY source of the downstream URL is the
 * selected agent's validated ENS record (`DiscoveredAgent.endpointUrl`, which
 * can only be produced by validateAgentEndpoint). Hardcoded URLs, environment
 * variables, LLM output, and router-side URL maps are never consulted here.
 *
 * CHECK 5: every downstream call has an EXPLICIT AbortController timeout
 * (AGENT_REQUEST_TIMEOUT_MS) — the HTTP client's default behavior is never
 * relied upon.
 *
 * The downstream response is UNTRUSTED DATA: it is Zod-validated before use,
 * and the agent's self-claimed identity is never trusted for attribution.
 */
import { z } from 'zod';

import type { DiscoveredAgent } from '../agents/types.js';
import { safeTruncate } from '../security/secrets.js';
import { summarizeIssues } from '../validation.js';
import type { AgentEndpointUrl } from '../security/endpoint.js';

/**
 * EXPLICIT downstream timeout (challenge CHECK 5). Every router -> specialist
 * agent HTTP call is aborted after this many milliseconds.
 */
export const AGENT_REQUEST_TIMEOUT_MS = 8_000;

export type InvokeFailureReason =
  | 'timeout'
  | 'http_error'
  | 'malformed_response'
  | 'network_error';

export interface InvokeResult {
  readonly ok: boolean;
  readonly answer?: string;
  readonly claimedAgent?: { readonly id: string | null; readonly name: string | null } | null;
  readonly identityMismatch?: boolean;
  readonly failureReason?: InvokeFailureReason;
  readonly httpStatus?: number;
  readonly detail?: string;
}

/**
 * Downstream response contract (see docs/ARCHITECTURE.md). The agent's claimed
 * identity is informational only; attribution comes from the router's
 * validated ENS-selected record.
 */
const InvokeResponseSchema = z.object({
  answer: z.string().min(1).max(20_000),
  agent: z
    .object({
      id: z.string().max(64).optional(),
      name: z.string().max(100).optional(),
    })
    .optional(),
});

/**
 * Build the standard `/invoke` URL from a validated ENS-derived endpoint.
 * The endpoint can only be an {@link AgentEndpointUrl} — a validated URL that
 * originated from the agent's ENS record (challenge CHECK 2).
 */
export function buildInvokeUrl(endpoint: AgentEndpointUrl): URL {
  const base = endpoint.href.endsWith('/') ? endpoint.href : `${endpoint.href}/`;
  return new URL('invoke', base);
}

/**
 * Forward the client request to the selected agent over HTTP with an explicit
 * timeout, and validate the response.
 */
export async function invokeAgent(
  agent: DiscoveredAgent,
  input: { readonly requestId: string; readonly message: string },
  timeoutMs: number = AGENT_REQUEST_TIMEOUT_MS,
): Promise<InvokeResult> {
  // SECURITY BOUNDARY (CHECK 2): the URL comes ONLY from the validated
  // ENS-derived agent record. There is no other URL source in this module.
  const url = buildInvokeUrl(agent.endpointUrl);

  // CHECK 5: explicit timeout — abort the request after timeoutMs.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: input.requestId,
        message: safeTruncate(input.message, 8_000),
        context: {},
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        failureReason: 'http_error',
        httpStatus: response.status,
        detail: `Agent "${agent.id}" responded with HTTP ${response.status}.`,
      };
    }

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (cause) {
      return {
        ok: false,
        failureReason: 'network_error',
        detail: `Could not read response body from agent "${agent.id}".`,
      };
    }

    let bodyJson: unknown;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      return {
        ok: false,
        failureReason: 'malformed_response',
        detail: `Agent "${agent.id}" response body is not valid JSON.`,
      };
    }

    // Downstream output is UNTRUSTED DATA — validate before use.
    const parsed = InvokeResponseSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return {
        ok: false,
        failureReason: 'malformed_response',
        detail: `Agent "${agent.id}" response failed validation: ${summarizeIssues(parsed.error)}`,
      };
    }

    const claimedAgent = parsed.data.agent ?? null;
    const claimedId = claimedAgent?.id ?? null;
    // The agent's self-claimed identity is never trusted: a mismatch is only
    // reported so the router can log it; attribution always uses the
    // router's ENS-validated record.
    const identityMismatch = claimedId !== null && claimedId !== agent.id;

    return {
      ok: true,
      answer: parsed.data.answer,
      claimedAgent: claimedAgent === null ? null : { id: claimedId, name: claimedAgent?.name ?? null },
      identityMismatch,
    };
  } catch (cause) {
    if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
      return {
        ok: false,
        failureReason: 'timeout',
        detail: `Agent "${agent.id}" request timed out after ${timeoutMs} ms.`,
      };
    }
    return {
      ok: false,
      failureReason: 'network_error',
      detail: `Agent "${agent.id}" request failed: ${cause instanceof Error ? safeTruncate(cause.message, 200) : 'unknown error'}.`,
    };
  } finally {
    // CHECK 5: always clear the explicit timeout.
    clearTimeout(timeout);
  }
}
