/**
 * Per-agent ENS record resolution (challenge CHECK 4).
 *
 * Every discovered agent is treated as UNTRUSTED DATA:
 *
 *   for each discovered ENS name:
 *     read ENS text records (Promise.allSettled — one failing read only fails
 *       THIS agent and never aborts discovery)
 *     validate with Zod (AgentRecordSchema)
 *     validate the endpoint (validateAgentEndpoint — HTTPS / localhost exception)
 *     if valid -> admit to the discovered-agent registry
 *     else     -> log a warning and skip the malformed agent
 *
 * One malformed agent must never abort the entire discovery process.
 */
import {
  AGENT_RECORD_KEYS,
  AgentRecordSchema,
  type DiscoveredAgent,
  type RawAgentRecords,
} from '../agents/types.js';
import { validateAgentEndpoint, type EndpointValidationOptions } from '../security/endpoint.js';
import { describeError } from '../security/secrets.js';
import { summarizeIssues } from '../validation.js';
import type { EnsGateway } from './client.js';
import { EnsLookupError } from './lookup-error.js';

export class AgentRecordValidationError extends Error {
  public override readonly name = 'AgentRecordValidationError';

  public constructor(
    public readonly ensName: string,
    issues: string,
  ) {
    super(`Agent ENS records for "${ensName}" failed validation: ${issues}`);
  }
}

/**
 * Parse + validate raw ENS text records for one agent into a
 * {@link DiscoveredAgent}. Throws {@link AgentRecordValidationError} or
 * {@link InvalidAgentEndpointError} when the record is malformed.
 */
export function parseAgentRecord(
  ensName: string,
  raw: RawAgentRecords,
  endpointOptions: EndpointValidationOptions,
): DiscoveredAgent {
  // All values below are UNTRUSTED DATA read from ENS.
  const capabilities = (raw.capabilities ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  const candidate = {
    ensName,
    id: raw.id,
    displayName: raw.name,
    description: raw.description,
    capabilities,
    endpoint: raw.endpoint,
    inputDescription: raw.input,
    version: raw.version,
  };

  const parsed = AgentRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AgentRecordValidationError(ensName, summarizeIssues(parsed.error));
  }

  // SECURITY BOUNDARY (CHECK 6): endpoint protocol validation happens BEFORE
  // the agent can enter the discovered-agent registry.
  const endpointUrl = validateAgentEndpoint(parsed.data.endpoint, endpointOptions);

  return {
    id: parsed.data.id,
    ensName,
    displayName: parsed.data.displayName,
    description: parsed.data.description,
    capabilities: parsed.data.capabilities,
    endpoint: parsed.data.endpoint,
    endpointUrl,
    inputDescription: parsed.data.inputDescription,
    version: parsed.data.version,
  };
}

/** The text records read for a single agent, in RawAgentRecords field order. */
const RECORD_READ_FIELDS = [
  { field: 'id', key: AGENT_RECORD_KEYS.id },
  { field: 'name', key: AGENT_RECORD_KEYS.name },
  { field: 'description', key: AGENT_RECORD_KEYS.description },
  { field: 'capabilities', key: AGENT_RECORD_KEYS.capabilities },
  { field: 'endpoint', key: AGENT_RECORD_KEYS.endpoint },
  { field: 'input', key: AGENT_RECORD_KEYS.input },
  { field: 'version', key: AGENT_RECORD_KEYS.version },
] as const;

/**
 * Read all text records for one agent ENS name and validate them.
 *
 * CHECK 4: Promise.allSettled is used so that a failing ENS read fails ONLY
 * this one agent (the caller skips it) — it can never abort the discovery of
 * the remaining agents.
 */
export async function resolveDiscoveredAgent(
  gateway: EnsGateway,
  ensName: string,
  endpointOptions: EndpointValidationOptions,
): Promise<DiscoveredAgent> {
  const settled = await Promise.allSettled(
    RECORD_READ_FIELDS.map(({ key }) => gateway.getTextRecord(ensName, key)),
  );

  const raw: RawAgentRecords = {
    id: null,
    name: null,
    description: null,
    capabilities: null,
    endpoint: null,
    input: null,
    version: null,
  };

  for (let index = 0; index < RECORD_READ_FIELDS.length; index += 1) {
    const outcome = settled[index];
    const field = RECORD_READ_FIELDS[index];
    if (outcome === undefined || field === undefined) {
      continue; // unreachable; guards noUncheckedIndexedAccess
    }
    if (outcome.status === 'rejected') {
      // A failing read for one record invalidates only THIS agent.
      throw new EnsLookupError(ensName, field.key, { cause: outcome.reason });
    }
    raw[field.field] = outcome.value;
  }

  return parseAgentRecord(ensName, raw, endpointOptions);
}

/** Render any discovery/resolve failure as a safe one-line reason string. */
export function describeDiscoveryFailure(cause: unknown): string {
  return describeError(cause);
}
