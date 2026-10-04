/**
 * LLM ROUTING + the security boundary for the model's choice
 * (challenge CHECK 1 + CHECK 7).
 *
 * The LLM returns a structured hint: {"agentId": "..."} or {"agentId": null}.
 * It NEVER sees or returns URLs. This module is the ONLY authority that turns
 * that hint into a routing decision:
 *
 *   validateRoutingDecision(decision, discoveredAgents)
 *     - decision.agentId === null  -> returns null  (=> CHECK 7 no-agent branch)
 *     - decision.agentId ∈ discoveredAgents -> returns the validated agent
 *     - otherwise -> throws ModelSelectedUnknownAgentError (=> explicit routing
 *       error; NO endpoint is ever called)
 *
 * The downstream URL comes exclusively from the selected agent's validated ENS
 * record — see invokeAgent() in src/router/forwarding.ts (challenge CHECK 2).
 */
import type { DiscoveredAgent } from '../agents/types.js';
import { buildRoutingMessages } from '../llm/prompt.js';
import { parseRoutingDecision } from '../llm/parse-decision.js';
import { RoutingDecisionSchema } from '../llm/schema.js';
import type { LlmClient } from '../llm/client.js';
import { describeError, safeTruncate } from '../security/secrets.js';

export type RoutingFailureReason =
  | 'llm_not_configured'
  | 'llm_unavailable'
  | 'invalid_model_output'
  | 'model_selected_unknown_agent';

/**
 * Raised when the model selected an agent id that is NOT in the
 * ENS-discovered, validated agent list. The pipeline catches this and returns
 * an explicit routing error — no endpoint is called.
 */
export class ModelSelectedUnknownAgentError extends Error {
  public override readonly name = 'ModelSelectedUnknownAgentError';

  public constructor(public readonly rejectedAgentId: string) {
    super(
      `Routing model selected "${rejectedAgentId}", which is NOT in the ENS-discovered agent list. Request rejected before any endpoint was called.`,
    );
  }
}

/**
 * SECURITY BOUNDARY (challenge CHECK 1).
 *
 * Independently verify the model's structured decision against the validated,
 * ENS-discovered agent list:
 *   - `null` decision        -> returns null (no suitable agent)
 *   - known agent id         -> returns the matching DiscoveredAgent
 *   - unknown agent id       -> throws ModelSelectedUnknownAgentError
 *
 * The model can never cause a fetch: only an agent returned by this function
 * (whose URL comes from its validated ENS record) may be forwarded to.
 */
export function validateRoutingDecision(
  decision: { agentId: string | null },
  discoveredAgents: readonly DiscoveredAgent[],
): DiscoveredAgent | null {
  // CHECK 7: a null decision means "no suitable agent" — handled explicitly by
  // the caller (no default agent, no random choice, no first-agent fallback).
  if (decision.agentId === null) {
    return null;
  }

  // CHECK 1: EXPLICIT MEMBERSHIP CHECK — the model's choice is only a hint and
  // is valid ONLY if it matches an agent that was discovered and validated
  // from live ENS data.
  const selected = discoveredAgents.find((agent) => agent.id === decision.agentId);
  if (selected === undefined) {
    throw new ModelSelectedUnknownAgentError(decision.agentId);
  }
  return selected;
}

export interface RoutingOutcome {
  readonly status: 'routed' | 'no_suitable_agent' | 'failed';
  readonly selectedAgent: DiscoveredAgent | null;
  readonly reason?: RoutingFailureReason;
  readonly detail?: string;
  /** The rejected model choice, safe to log (id string only, truncated). */
  readonly rejectedModelChoice?: string;
}

/**
 * Run the LLM routing step: build the constrained prompt from the validated
 * discovered agents, get a structured decision, and validate it against the
 * discovered list. The model never receives or returns URLs.
 */
export async function routeWithLlm(
  llm: LlmClient | null,
  message: string,
  discoveredAgents: readonly DiscoveredAgent[],
): Promise<RoutingOutcome> {
  // The LLM is required for routing; there is no silent fallback.
  if (llm === null) {
    return {
      status: 'failed',
      selectedAgent: null,
      reason: 'llm_not_configured',
      detail: 'The routing model is not configured. Set LLM_API_KEY to enable LLM routing.',
    };
  }

  // Step 1: call the LLM with the constrained, URL-free agent list.
  let raw: string;
  try {
    raw = await llm.complete(buildRoutingMessages(message, discoveredAgents));
  } catch (cause) {
    return {
      status: 'failed',
      selectedAgent: null,
      reason: 'llm_unavailable',
      detail: describeError(cause),
    };
  }

  // Step 2: parse the structured decision (Zod-validated; unknown keys stripped).
  let decision: { agentId: string | null };
  try {
    decision = parseRoutingDecision(raw);
  } catch (cause) {
    return {
      status: 'failed',
      selectedAgent: null,
      reason: 'invalid_model_output',
      detail: describeError(cause),
    };
  }

  // Step 3: CHECK 1 — independently enforce membership against discoveredAgents.
  try {
    const selected = validateRoutingDecision(decision, discoveredAgents);
    if (selected === null) {
      // CHECK 7: the model explicitly said no discovered agent fits.
      return { status: 'no_suitable_agent', selectedAgent: null };
    }
    return { status: 'routed', selectedAgent: selected };
  } catch (cause) {
    if (cause instanceof ModelSelectedUnknownAgentError) {
      // CHECK 1 enforcement: rejected model choice, logged safely by the caller.
      return {
        status: 'failed',
        selectedAgent: null,
        reason: 'model_selected_unknown_agent',
        detail: cause.message,
        rejectedModelChoice: safeTruncate(cause.rejectedAgentId, 64),
      };
    }
    throw cause;
  }
}

/** Re-export so the server can build the decision schema for request parsing. */
export { RoutingDecisionSchema };
