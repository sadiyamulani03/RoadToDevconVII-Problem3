/**
 * Standardized downstream agent HTTP contract (documented in
 * docs/ARCHITECTURE.md). Every specialist agent exposes:
 *
 *   POST /invoke
 *     Request:  { "requestId": "...", "message": "...", "context": {} }
 *     Response: { "answer": "...", "agent": { "id": "...", "name": "..." } }
 *
 * The router validates this response itself with its own Zod schema and never
 * trusts the agent's claimed identity for attribution.
 */
import { z } from 'zod';

export const InvokeRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  message: z.string().min(1).max(8_000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type InvokeRequest = z.infer<typeof InvokeRequestSchema>;

export interface AgentIdentity {
  readonly id: string;
  readonly name: string;
}

/**
 * A specialist agent definition. `identity` mirrors what this agent publishes
 * in its ENS text records (agent.id / agent.name).
 */
export interface AgentDefinition {
  readonly identity: AgentIdentity;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly version: string;
  readonly port: number;
  /** Handle one validated invoke request; return the answer text. */
  readonly handle: (input: InvokeRequest) => Promise<string>;
}
