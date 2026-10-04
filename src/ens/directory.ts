/**
 * ENS DIRECTORY — the single discovery root (challenge CHECK 3).
 *
 * The router is configured with EXACTLY ONE ENS identity: the directory name
 * (from the ENS_DIRECTORY_NAME environment variable). The set of specialist
 * agents is read from the directory name's `agents.directory` text record at
 * runtime as machine-readable JSON:
 *
 *   {"version": 1, "agents": ["contract-agent.example.eth", "brand-agent.example.eth"]}
 *
 * The router source contains NO individual agent list: adding a fourth agent is
 * a pure ENS operation (publish its records, update the directory record) with
 * no router source-code change.
 */
import { z } from 'zod';

import { summarizeIssues } from '../validation.js';
import type { EnsGateway } from './client.js';

/** Text record key on the directory ENS name that lists the agent ENS names. */
export const DIRECTORY_RECORD_KEY = 'agents.directory';

/**
 * Schema for the directory record. The `agents` entries are still treated as
 * untrusted data: each entry must additionally pass ENS-name format validation
 * before it is resolved (see discovery.ts).
 */
export const DirectoryRecordSchema = z.object({
  version: z.literal(1),
  agents: z.array(z.string().min(1).max(253)).max(100),
});

export type DirectoryRecord = z.infer<typeof DirectoryRecordSchema>;

export class DirectoryRecordError extends Error {
  public override readonly name = 'DirectoryRecordError';

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Read + validate the directory record from live ENS.
 * Throws {@link DirectoryRecordError} (or {@link EnsLookupError}) when the
 * record is missing, malformed, or fails schema validation.
 */
export async function readDirectoryRecord(
  gateway: EnsGateway,
  directoryName: string,
): Promise<DirectoryRecord> {
  const raw = await gateway.getTextRecord(directoryName, DIRECTORY_RECORD_KEY);

  if (raw === null) {
    throw new DirectoryRecordError(
      `ENS name "${directoryName}" has no "${DIRECTORY_RECORD_KEY}" text record. Publish it with scripts/publish-agents.ts.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new DirectoryRecordError(
      `"${DIRECTORY_RECORD_KEY}" text record on "${directoryName}" is not valid JSON.`,
      { cause },
    );
  }

  const parsed = DirectoryRecordSchema.safeParse(json);
  if (!parsed.success) {
    throw new DirectoryRecordError(
      `"${DIRECTORY_RECORD_KEY}" text record on "${directoryName}" failed schema validation: ${summarizeIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}
