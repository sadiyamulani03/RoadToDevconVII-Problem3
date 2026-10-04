/**
 * RUNTIME DISCOVERY — builds the validated discovered-agent list from live ENS
 * (challenge CHECK 3 + CHECK 4).
 *
 * Flow:
 *   1. read the directory record (the ONLY configured ENS identity) to get the
 *      candidate agent ENS names — no agent list exists in router source code;
 *   2. resolve each candidate agent INDEPENDENTLY with Promise.allSettled so a
 *      malformed or unreachable agent record can NEVER abort the discovery;
 *   3. admit only agents whose records passed Zod validation AND endpoint
 *      protocol validation; skip and log the rest.
 */
import type { DiscoveredAgent } from '../agents/types.js';
import { isValidEnsName } from '../ens/names.js';
import { readDirectoryRecord } from '../ens/directory.js';
import { resolveDiscoveredAgent } from '../ens/records.js';
import type { EnsGateway } from '../ens/client.js';
import { safeTruncate } from '../security/secrets.js';

/** A malformed/unreachable agent that was skipped during discovery. */
export interface DiscoverySkip {
  readonly ensName: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly directoryName: string;
  readonly agents: readonly DiscoveredAgent[];
  readonly skipped: readonly DiscoverySkip[];
}

export interface DiscoveryOptions {
  readonly allowInsecureLocalhost: boolean;
  /** 0 (default) = always discover fresh; > 0 = TTL cache in milliseconds. */
  readonly cacheTtlMs?: number;
  /** Optional logger for skip warnings. */
  readonly logger?: { warn(scope: string, message: string): void };
}

// Module-level TTL cache (disabled by default: cacheTtlMs = 0).
const discoveryCache = new Map<string, { at: number; result: DiscoveryResult }>();

/** Clear the discovery cache (used by tests and by a manual refresh). */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Discover the validated specialist agents from live ENS data.
 *
 * SECURITY: every returned {@link DiscoveredAgent} has passed Zod validation
 * and endpoint protocol validation. Malformed agents are skipped, never fatal.
 */
export async function discoverAgents(
  gateway: EnsGateway,
  directoryName: string,
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const cacheTtlMs = options.cacheTtlMs ?? 0;

  if (cacheTtlMs > 0) {
    const cached = discoveryCache.get(directoryName);
    if (cached !== undefined && Date.now() - cached.at < cacheTtlMs) {
      return cached.result;
    }
  }

  // Step 1: read the directory record (list of candidate agent ENS names).
  const directory = await readDirectoryRecord(gateway, directoryName);

  // Directory entries are still untrusted data: only well-formed ENS names are resolved.
  const candidateNames: string[] = [];
  const seenNames = new Set<string>();
  for (const entry of directory.agents) {
    const name = entry.trim().toLowerCase();
    if (!isValidEnsName(name)) {
      options.logger?.warn(
        'discovery',
        `Skipping invalid ENS name in directory record: ${safeTruncate(name, 100)}`,
      );
      continue;
    }
    if (seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    candidateNames.push(name);
  }

  // Step 2: resolve each candidate independently. CHECK 4: Promise.allSettled
  // guarantees one malformed/unreachable agent can never abort the discovery.
  const settled = await Promise.allSettled(
    candidateNames.map((name) =>
      resolveDiscoveredAgent(gateway, name, {
        allowInsecureLocalhost: options.allowInsecureLocalhost,
      }),
    ),
  );

  // Runtime accumulator for the discovered agents — built from live ENS data,
  // never a hardcoded list.
  const discovered: DiscoveredAgent[] = [];
  const skipped: DiscoverySkip[] = [];
  const seenAgentIds = new Set<string>();

  for (let index = 0; index < candidateNames.length; index += 1) {
    const ensName = candidateNames[index];
    const outcome = settled[index];
    if (ensName === undefined || outcome === undefined) {
      continue; // unreachable; guards noUncheckedIndexedAccess
    }

    if (outcome.status === 'fulfilled') {
      const agent = outcome.value;
      if (seenAgentIds.has(agent.id)) {
        skipped.push({
          ensName,
          reason: `duplicate agent id "${agent.id}" — first discovery wins`,
        });
        continue;
      }
      seenAgentIds.add(agent.id);
      discovered.push(agent);
    } else {
      // Step 3 (skip branch): log a warning and continue discovery.
      const reason =
        outcome.reason instanceof Error
          ? safeTruncate(outcome.reason.message, 300)
          : safeTruncate(String(outcome.reason), 300);
      skipped.push({ ensName, reason });
      options.logger?.warn('discovery', `Skipped malformed agent "${ensName}": ${reason}`);
    }
  }

  const result: DiscoveryResult = { directoryName, agents: discovered, skipped };
  if (cacheTtlMs > 0) {
    discoveryCache.set(directoryName, { at: Date.now(), result });
  }
  return result;
}
