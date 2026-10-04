/**
 * Safe routing telemetry / observability.
 *
 * SECURITY: routing logs NEVER contain API keys, authorization headers,
 * private keys, or other secrets. Only the structured fields below are
 * recorded; every untrusted string is control-stripped and truncated before
 * being written (see safeTruncate in src/security/secrets.ts).
 */
import { safeTruncate } from '../security/secrets.js';
import type { RouteStatus } from '../router/router.js';

export interface RoutingLogEntry {
  readonly timestamp: string;
  readonly requestId: string;
  /** Truncated client request preview (<=120 chars) for categorization. */
  readonly messagePreview: string;
  readonly discoveredAgentIds: readonly string[];
  /** Raw model choice (safe id string only), before membership validation. */
  readonly modelSelectedAgentId: string | null;
  /** The validated selected agent (verified against the discovered list). */
  readonly validatedSelectedAgentId: string | null;
  readonly finalStatus: RouteStatus;
  readonly latencyMs: number;
  readonly failureReason?: string;
  readonly detail?: string;
  readonly rejectedModelChoice?: string;
  readonly skippedAgents?: ReadonlyArray<{ readonly ensName: string; readonly reason: string }>;
  /** True when the agent's claimed identity matched its ENS-published id. */
  readonly identityVerified?: boolean;
}

export interface RoutingLogger {
  record(entry: RoutingLogEntry): void;
  info(scope: string, message: string): void;
  warn(scope: string, message: string): void;
  entries(): readonly RoutingLogEntry[];
}

/** In-memory ring-buffer logger that emits single-line JSON to the console. */
export function createRoutingLogger(maxEntries = 200): RoutingLogger {
  const buffer: RoutingLogEntry[] = [];

  const push = (entry: RoutingLogEntry): void => {
    buffer.push(entry);
    if (buffer.length > maxEntries) {
      buffer.shift();
    }
    console.info(JSON.stringify(entry));
  };

  return {
    record: push,
    info(scope: string, message: string): void {
      console.info(JSON.stringify({ level: 'info', scope, message: safeTruncate(message, 300) }));
    },
    warn(scope: string, message: string): void {
      console.warn(JSON.stringify({ level: 'warn', scope, message: safeTruncate(message, 300) }));
    },
    entries(): readonly RoutingLogEntry[] {
      return buffer;
    },
  };
}
