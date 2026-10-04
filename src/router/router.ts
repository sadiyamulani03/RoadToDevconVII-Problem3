/**
 * THE ROUTING PIPELINE — the single orchestration point for every client
 * request. Steps are numbered to mirror docs/ARCHITECTURE.md.
 *
 * ── SECURITY BOUNDARIES (challenge checks) ──────────────────────────────────
 *  - CHECK 1: the LLM only returns a structured {"agentId": ...} hint; it is
 *    validated against the ENS-discovered agent list in
 *    validateRoutingDecision() BEFORE anything is called. The model never
 *    controls which URL is fetched.
 *  - CHECK 2: the forwarded URL comes ONLY from the selected agent's validated
 *    ENS record (see invokeAgent() in src/router/forwarding.ts).
 *  - CHECK 3: no agent list exists in this source tree; agents are discovered
 *    at runtime from live ENS data via the configured directory name.
 *  - CHECK 4: malformed ENS records are skipped; discovery never aborts.
 *  - CHECK 5: every downstream call has an explicit timeout.
 *  - CHECK 7: the explicit no_suitable_agent branch is below — no default
 *    agent, no random choice, no first-agent fallback, no silent failure.
 */
import { z } from 'zod';

import { discoverAgents, type DiscoveryResult, type DiscoverySkip } from './discovery.js';
import { invokeAgent } from './forwarding.js';
import { routeWithLlm, type RoutingFailureReason } from './routing.js';
import type { EnsGateway } from '../ens/client.js';
import type { LlmClient } from '../llm/client.js';
import type { RoutingLogger } from '../observability/routing-log.js';
import type { RouterConfig } from '../config.js';
import { describeError, safeTruncate } from '../security/secrets.js';

export type RouteStatus =
  | 'answered'
  | 'no_suitable_agent'
  | 'routing_failed'
  | 'agent_unavailable'
  | 'discovery_unavailable'
  | 'invalid_request';

/** ENS-derived attribution of the agent that actually answered. */
export interface Attribution {
  readonly agentId: string;
  readonly ensName: string;
  readonly displayName: string;
  /** From the validated ENS record (public metadata, not a secret). */
  readonly endpoint: string;
}

export interface RouteResult {
  readonly status: RouteStatus;
  readonly requestId: string;
  readonly answer?: string;
  readonly message?: string;
  readonly attribution: Attribution | null;
  readonly discoveredAgentIds?: readonly string[];
  readonly skippedAgents?: readonly DiscoverySkip[];
  readonly failureReason?: string;
  readonly detail?: string;
}

/** Dependencies are injected so tests can provide fakes for ENS and the LLM. */
export interface RouteDeps {
  readonly config: RouterConfig;
  readonly ens: EnsGateway;
  readonly llm: LlmClient | null;
  readonly logger: RoutingLogger;
}

/** The client request contract (untrusted input; validated with Zod). */
const RouteRequestSchema = z.object({
  message: z.string().min(1).max(4_000),
});

function routingFailureMessage(reason: RoutingFailureReason): string {
  switch (reason) {
    case 'llm_not_configured':
      return 'The routing model is not configured. Set LLM_API_KEY to enable LLM routing.';
    case 'llm_unavailable':
      return 'The routing model could not be reached.';
    case 'invalid_model_output':
      return 'The routing model returned an invalid routing decision.';
    case 'model_selected_unknown_agent':
      return 'The routing model selected an agent that was not discovered from ENS. The request was rejected before any endpoint was called.';
  }
}

/** Extract a safe, truncated message preview for telemetry. */
function extractMessagePreview(raw: unknown): string {
  if (typeof raw === 'string') {
    return safeTruncate(raw, 120);
  }
  if (typeof raw === 'object' && raw !== null && 'message' in raw) {
    const candidate = (raw as { message?: unknown }).message;
    if (typeof candidate === 'string') {
      return safeTruncate(candidate, 120);
    }
  }
  return '';
}

/**
 * Route a client request through the full pipeline:
 *
 *   1.  Receive client request.
 *   2.  Validate client request (Zod; untrusted input).
 *   3.  Discover agent ENS names from the ENS directory record.
 *   4.  Resolve each agent ENS record.
 *   5.  Parse and validate each record with Zod.
 *   6.  Skip malformed agents (discovery never aborts).
 *   7.  Validate each endpoint (HTTPS / explicit localhost exception).
 *   8.  Build the runtime discovered-agent list.
 *   9.  If zero valid agents exist, return a clear discovery response.
 *   10. Send only validated agent descriptions/capabilities to the LLM.
 *   11. Parse the structured LLM routing decision (Zod).
 *   12. Validate the chosen agent id against discoveredAgents (CHECK 1).
 *   13. If null, return the explicit no-suitable-agent response (CHECK 7).
 *   14. Retrieve the selected agent from discoveredAgents.
 *   15. Use ONLY its ENS-derived validated endpoint (CHECK 2).
 *   16. Perform the downstream HTTP request with an explicit timeout (CHECK 5).
 *   17. Validate the downstream response (untrusted data).
 *   18. Return answer + ENS attribution.
 *   19. Record routing telemetry (all paths, safe fields only).
 */
export async function routeRequest(rawInput: unknown, deps: RouteDeps): Promise<RouteResult> {
  const startedAtMs = Date.now();
  const requestId = newRequestId();
  const logger = deps.logger;

  const finish = (
    result: {
      status: RouteStatus;
      answer?: string;
      message?: string;
      attribution: Attribution | null;
      discoveredAgentIds?: readonly string[];
      skippedAgents?: readonly DiscoverySkip[];
      failureReason?: string;
      detail?: string;
    },
    telemetry: {
      discoveredAgentIds: readonly string[];
      modelSelectedAgentId: string | null;
      validatedSelectedAgentId: string | null;
      rejectedModelChoice?: string;
      identityVerified?: boolean;
    },
  ): RouteResult => {
    // Step 19: record telemetry on every path (safe fields only).
    logger.record({
      timestamp: new Date().toISOString(),
      requestId,
      messagePreview: extractMessagePreview(rawInput),
      discoveredAgentIds: telemetry.discoveredAgentIds,
      modelSelectedAgentId: telemetry.modelSelectedAgentId,
      validatedSelectedAgentId: telemetry.validatedSelectedAgentId,
      finalStatus: result.status,
      latencyMs: Date.now() - startedAtMs,
      ...(result.failureReason !== undefined ? { failureReason: result.failureReason } : {}),
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      ...(telemetry.rejectedModelChoice !== undefined
        ? { rejectedModelChoice: telemetry.rejectedModelChoice }
        : {}),
      ...(result.skippedAgents !== undefined ? { skippedAgents: result.skippedAgents } : {}),
      ...(telemetry.identityVerified !== undefined
        ? { identityVerified: telemetry.identityVerified }
        : {}),
    });
    return { requestId, ...result };
  };

  // ── Steps 1–2: validate the client request (untrusted input) ──
  const parsedRequest = RouteRequestSchema.safeParse(rawInput);
  if (!parsedRequest.success) {
    return finish(
      {
        status: 'invalid_request',
        message:
          'Invalid request: "message" must be a non-empty string of at most 4000 characters.',
        attribution: null,
        failureReason: 'invalid_request',
      },
      { discoveredAgentIds: [], modelSelectedAgentId: null, validatedSelectedAgentId: null },
    );
  }
  const message = parsedRequest.data.message;

  // ── Steps 3–8: discover + validate agents from live ENS data ──
  let discovery: DiscoveryResult;
  try {
    discovery = await discoverAgents(deps.ens, deps.config.ens.directoryName, {
      allowInsecureLocalhost: deps.config.allowLocalhostEndpoints,
      cacheTtlMs: deps.config.discoveryCacheTtlMs,
      logger: deps.logger,
    });
  } catch (cause) {
    // Directory-level failure (missing/malformed directory record) → clear
    // service response, never a crash (pipeline step 9).
    return finish(
      {
        status: 'discovery_unavailable',
        message:
          'Agent discovery is unavailable: the ENS directory record could not be read or was invalid.',
        attribution: null,
        failureReason: 'directory_unreadable',
        detail: describeError(cause),
      },
      { discoveredAgentIds: [], modelSelectedAgentId: null, validatedSelectedAgentId: null },
    );
  }

  const discoveredAgentIds = discovery.agents.map((agent) => agent.id);

  // ── Step 9: zero valid agents → clear discovery/service response ──
  if (discovery.agents.length === 0) {
    return finish(
      {
        status: 'discovery_unavailable',
        message:
          'No valid agents were discovered from ENS; the directory contains no usable specialist records.',
        attribution: null,
        discoveredAgentIds,
        skippedAgents: discovery.skipped,
        failureReason: 'no_valid_agents',
      },
      { discoveredAgentIds, modelSelectedAgentId: null, validatedSelectedAgentId: null },
    );
  }

  // ── Steps 10–12: LLM routing decision (structured, Zod-validated,
  //    membership-checked against the discovered list) ──
  const outcome = await routeWithLlm(deps.llm, message, discovery.agents);

  if (outcome.status === 'failed') {
    // CHECK 1 enforcement: an unknown model choice is rejected BEFORE any
    // endpoint is called; the rejected choice is logged safely.
    return finish(
      {
        status: 'routing_failed',
        message: routingFailureMessage(outcome.reason ?? 'invalid_model_output'),
        attribution: null,
        discoveredAgentIds,
        failureReason: outcome.reason,
        detail: outcome.detail,
      },
      {
        discoveredAgentIds,
        modelSelectedAgentId: outcome.rejectedModelChoice ?? null,
        validatedSelectedAgentId: null,
        rejectedModelChoice: outcome.rejectedModelChoice,
      },
    );
  }

  // ── CHECK 7: explicit no-suitable-agent branch ──
  // The router must NOT choose a default agent, pick randomly, call the first
  // discovered agent, return a blank answer, or silently fail.
  if (outcome.status === 'no_suitable_agent' || outcome.selectedAgent === null) {
    return finish(
      {
        status: 'no_suitable_agent',
        message: 'No suitable agent was found for this request.',
        attribution: null,
        discoveredAgentIds,
      },
      { discoveredAgentIds, modelSelectedAgentId: null, validatedSelectedAgentId: null },
    );
  }
  const selected = outcome.selectedAgent;

  // ── Steps 14–17: forward using ONLY the ENS-derived validated endpoint ──
  // invokeAgent() takes the URL exclusively from selected.endpointUrl, which
  // was produced by validateAgentEndpoint() during discovery (CHECK 2 + 6),
  // and applies the explicit timeout (CHECK 5).
  const invocation = await invokeAgent(
    selected,
    { requestId, message },
    deps.config.agentRequestTimeoutMs,
  );

  if (!invocation.ok) {
    return finish(
      {
        status: 'agent_unavailable',
        message: 'The selected agent could not be reached or returned an invalid response.',
        attribution: null,
        discoveredAgentIds,
        failureReason: invocation.failureReason,
        detail: invocation.detail,
      },
      { discoveredAgentIds, modelSelectedAgentId: selected.id, validatedSelectedAgentId: selected.id },
    );
  }

  // Step 17 (identity): the agent's self-claimed identity is never trusted —
  // attribution comes from the router's validated ENS-selected record.
  if (invocation.identityMismatch === true) {
    logger.warn(
      'forwarding',
      `Agent "${selected.id}" claimed a different identity (claimed id: ${safeTruncate(invocation.claimedAgent?.id ?? 'unknown', 64)}); attribution uses the ENS-validated record.`,
    );
  }

  // ── Step 18: answer + attribution from the ENS-selected agent ──
  return finish(
    {
      status: 'answered',
      answer: invocation.answer,
      attribution: {
        agentId: selected.id,
        ensName: selected.ensName,
        displayName: selected.displayName,
        endpoint: selected.endpoint,
      },
      discoveredAgentIds,
    },
    {
      discoveredAgentIds,
      modelSelectedAgentId: selected.id,
      validatedSelectedAgentId: selected.id,
      identityVerified: !invocation.identityMismatch,
    },
  );
}

/** New unique request id. */
function newRequestId(): string {
  return crypto.randomUUID();
}
