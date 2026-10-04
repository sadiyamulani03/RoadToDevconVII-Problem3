/**
 * Shared test helpers: fakes for the ENS gateway, the LLM, the logger, and a
 * real local HTTP downstream server for forwarding tests.
 *
 * SECURITY (CHECK 9): every value in this file is an obvious fixture/fake —
 * no real credentials, keys, or authenticated URLs. Local test servers use the
 * router's explicit localhost exception (challenge CHECK 6 allows plain http://
 * for loopback hosts in development/testing).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { DiscoveredAgent, RawAgentRecords } from '../src/agents/types.js';
import type { EnsGateway } from '../src/ens/client.js';
import { EnsLookupError } from '../src/ens/lookup-error.js';
import { parseAgentRecord } from '../src/ens/records.js';
import type { LlmClient, LlmMessage } from '../src/llm/client.js';
import type { RoutingLogEntry, RoutingLogger } from '../src/observability/routing-log.js';
import type { RouterConfig } from '../src/config.js';

export const TEST_DIRECTORY_NAME = 'agent-directory.test.eth';

/** Build raw ENS text records (all values are fakes). */
export function makeRawRecords(
  overrides: Partial<Record<keyof RawAgentRecords, string | null>> = {},
): RawAgentRecords {
  return {
    id: 'invoice-specialist',
    name: 'Invoice Assistant',
    description: 'Answers questions about invoices, overdue invoices, and billing.',
    capabilities: 'invoices,billing,overdue',
    endpoint: 'https://invoice-agent.test.example',
    input: 'A natural-language question about invoices.',
    version: '1.0.0',
    ...overrides,
  };
}

/** Build a fully validated DiscoveredAgent through the REAL validation path. */
export function makeAgent(
  overrides: Partial<Record<keyof RawAgentRecords, string | null>> = {},
  ensName: string = 'invoice-agent.test.eth',
): DiscoveredAgent {
  return parseAgentRecord(ensName, makeRawRecords(overrides), {
    allowInsecureLocalhost: true,
  });
}

/** Build a test router config (all values are fakes). */
export function makeConfig(overrides: Partial<RouterConfig> = {}): RouterConfig {
  const base: RouterConfig = {
    port: 8_787,
    nodeEnv: 'test',
    ens: {
      directoryName: TEST_DIRECTORY_NAME,
      rpcUrl: 'http://127.0.0.1:1',
      universalResolverAddress: null,
    },
    llm: {
      baseUrl: 'https://api.openai.test.example/v1',
      apiKey: 'test-key-not-real',
      model: 'test-model',
      timeoutMs: 5_000,
      jsonMode: true,
    },
    agentRequestTimeoutMs: 8_000,
    allowLocalhostEndpoints: true,
    discoveryCacheTtlMs: 0,
  };
  return { ...base, ...overrides };
}

/** In-memory fake EnsGateway. */
export class FakeEnsGateway implements EnsGateway {
  private readonly records = new Map<string, Map<string, string>>();
  private readonly unresolvedNames = new Set<string>();

  /** Calls observed, for assertions. */
  public readonly calls: Array<{ name: string; key: string }> = [];

  public async getTextRecord(name: string, key: string): Promise<string | null> {
    this.calls.push({ name, key });
    if (this.unresolvedNames.has(name)) {
      throw new EnsLookupError(name, key, { cause: new Error('simulated ENS lookup failure') });
    }
    return this.records.get(name)?.get(key) ?? null;
  }

  /** Publish agent text records (only non-null fields are written). */
  public setAgentRecords(ensName: string, records: RawAgentRecords): void {
    const entry = new Map<string, string>();
    const fields: ReadonlyArray<[keyof RawAgentRecords, string | null]> = [
      ['id', records.id],
      ['name', records.name],
      ['description', records.description],
      ['capabilities', records.capabilities],
      ['endpoint', records.endpoint],
      ['input', records.input],
      ['version', records.version],
    ];
    for (const [field, value] of fields) {
      if (value !== null) {
        entry.set(`agent.${field}`, value);
      }
    }
    this.records.set(ensName, entry);
  }

  /** Publish a valid agents.directory record. */
  public setDirectory(agentNames: readonly string[]): void {
    this.setDirectoryRaw(JSON.stringify({ version: 1, agents: agentNames }));
  }

  /** Publish a raw (possibly malformed) agents.directory value. */
  public setDirectoryRaw(value: string): void {
    this.records.set(
      TEST_DIRECTORY_NAME,
      new Map([['agents.directory', value]]),
    );
  }

  /** Simulate an agent name that cannot be resolved at all. */
  public setUnresolved(ensName: string): void {
    this.unresolvedNames.add(ensName);
  }
}

/** Fake LLM client that returns a canned response (or throws). */
export class FakeLlmClient implements LlmClient {
  /** Calls observed, for prompt assertions. */
  public readonly calls: Array<{ messages: readonly LlmMessage[] }> = [];

  public constructor(private readonly response: string | Error) {}

  public async complete(messages: readonly LlmMessage[]): Promise<string> {
    this.calls.push({ messages });
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

/** Fake RoutingLogger that records entries and warnings for assertions. */
export class FakeLogger implements RoutingLogger {
  public readonly recorded: RoutingLogEntry[] = [];
  public readonly warnings: Array<{ scope: string; message: string }> = [];

  public record(entry: RoutingLogEntry): void {
    this.recorded.push(entry);
  }
  public info(): void {
    // not asserted
  }
  public warn(scope: string, message: string): void {
    this.warnings.push({ scope, message });
  }
  public entries(): readonly RoutingLogEntry[] {
    return this.recorded;
  }
}

export interface DownstreamServer {
  /** Base URL, e.g. http://127.0.0.1:41234 */
  readonly url: string;
  /** Captured requests (full URL, method, parsed body). */
  readonly requests: Array<{ url: string; method: string; body: unknown }>;
  close(): Promise<void>;
}

/**
 * Start a REAL local HTTP server (ephemeral port) to act as a downstream
 * specialist agent. Uses 127.0.0.1 — the router's explicit localhost
 * development exception.
 */
export function startDownstreamServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        answer: 'Invoice INV-2026-001 (Acme Design Studio, $4,800.00) is overdue by 14 days.',
        agent: { id: 'invoice-specialist', name: 'Invoice Assistant' },
      }),
    );
  },
): Promise<DownstreamServer> {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({ url: `http://${req.headers.host ?? ''}${req.url ?? ''}`, method: req.method ?? '', body });
      handler(req, res, body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise((resolveClose) => {
            // Destroy lingering (e.g. timed-out) connections so close() resolves.
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
