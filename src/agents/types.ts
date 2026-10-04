/**
 * Agent metadata types + Zod schemas (challenge CHECK 4).
 *
 * Everything an agent publishes in ENS is UNTRUSTED DATA. The only way a value
 * becomes a usable {@link DiscoveredAgent} is:
 *
 *   ENS text records -> Zod (AgentRecordSchema) -> endpoint validation
 *   (validateAgentEndpoint) -> DiscoveredAgent
 *
 * Text record keys published under each agent ENS name (documented in
 * docs/ENS_RECORD_FORMAT.md):
 *
 *   agent.id           required   machine-readable id slug (e.g. "my-agent-id"); the
 *                                 router never hardcodes any of these
 *   agent.name         required   display name, e.g. "Invoice Assistant"
 *   agent.description  required   what the agent is for
 *   agent.capabilities required   comma-separated capability slugs
 *   agent.endpoint     required   HTTP(S) endpoint of the agent (protocol-validated)
 *   agent.input        optional   description of the accepted input
 *   agent.version      required   semver string, e.g. "1.0.0"
 */
import { z } from 'zod';

import type { AgentEndpointUrl } from '../security/endpoint.js';

/** ENS text record keys used for agent metadata. */
export const AGENT_RECORD_KEYS = {
  id: 'agent.id',
  name: 'agent.name',
  description: 'agent.description',
  capabilities: 'agent.capabilities',
  endpoint: 'agent.endpoint',
  input: 'agent.input',
  version: 'agent.version',
} as const;

/** Machine-readable agent id (also the key the LLM is allowed to choose). */
export const AGENT_ID_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
/** Capability slug (used inside agent.capabilities). */
export const CAPABILITY_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
/** Semver string. */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const AgentRecordSchema = z.object({
  /** ENS name the record was resolved from (added by the discovery layer). */
  ensName: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/, 'must be a lowercase ENS name'),
  id: z.string().regex(AGENT_ID_PATTERN, 'must be a lowercase slug, e.g. "my-agent-id"'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(1_000),
  capabilities: z.array(z.string().regex(CAPABILITY_PATTERN, 'must be a lowercase slug')).min(1).max(16),
  /** Raw endpoint string. Protocol is validated separately by validateAgentEndpoint. */
  endpoint: z.string().min(1).max(2_048),
  inputDescription: z.string().min(1).max(1_000).nullable(),
  version: z.string().regex(SEMVER_PATTERN, 'must be semver, e.g. "1.0.0"'),
});

/** Zod-validated agent metadata derived from ENS text records. */
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

/**
 * A fully validated discovered agent.
 *
 * SECURITY: instances can only be created through the discovery pipeline
 * (parseAgentRecord), which runs Zod validation AND endpoint protocol
 * validation before the agent is admitted to the registry.
 */
export interface DiscoveredAgent {
  readonly id: string;
  readonly ensName: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  /** Raw endpoint string exactly as published in ENS (already protocol-validated). */
  readonly endpoint: string;
  /**
   * Parsed + validated endpoint URL — the ONLY permitted base URL for
   * downstream forwarding (challenge CHECK 2).
   */
  readonly endpointUrl: AgentEndpointUrl;
  readonly inputDescription: string | null;
  readonly version: string;
}

/**
 * The safe projection of a discovered agent that is sent to the routing LLM.
 * SECURITY: deliberately contains NO endpoint and NO URL — the model must
 * never see or return network locations (challenge CHECK 1 + CHECK 2).
 */
export interface LlmAgentView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
}

/** Project a validated agent into the constrained view given to the LLM. */
export function toLlmAgentView(agent: DiscoveredAgent): LlmAgentView {
  return {
    id: agent.id,
    name: agent.displayName,
    description: agent.description,
    capabilities: agent.capabilities,
  };
}

/**
 * Raw text records exactly as read from ENS for one agent name (all values are
 * untrusted; unset records are null). Mutable: filled in by resolveDiscoveredAgent.
 */
export interface RawAgentRecords {
  id: string | null;
  name: string | null;
  description: string | null;
  capabilities: string | null;
  endpoint: string | null;
  input: string | null;
  version: string | null;
}
