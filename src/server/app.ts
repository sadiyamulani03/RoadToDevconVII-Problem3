/**
 * HTTP server for the ENS agent router.
 *
 * Endpoints:
 *   POST /route        — route a client request (the primary API)
 *   GET  /agents       — the currently discovered, validated agents (from ENS)
 *   GET  /routing-log  — safe routing telemetry
 *   GET  /health       — liveness
 *   GET  /             — demo UI (the CLI/API remains the source of truth)
 *
 * SECURITY: the server never exposes secrets (the LLM API key never appears in
 * any response). All request bodies are treated as untrusted data and
 * validated with Zod before use.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { loadRouterConfig, type RouterConfig } from '../config.js';
import { createViemEnsGateway, type EnsGateway } from '../ens/client.js';
import { discoverAgents } from '../router/discovery.js';
import { routeRequest, type RouteDeps, type RouteStatus } from '../router/router.js';
import { describeError } from '../security/secrets.js';
import { createRoutingLogger, type RoutingLogger } from '../observability/routing-log.js';
import { createOpenAiCompatibleLlmClient, type LlmClient } from '../llm/client.js';
import { DEMO_PAGE_HTML } from './demo-page.js';

export interface RouterDeps {
  readonly config: RouterConfig;
  readonly ens: EnsGateway;
  readonly llm: LlmClient | null;
  readonly logger: RoutingLogger;
}

const HTTP_STATUS_BY_ROUTE_STATUS: Record<RouteStatus, ContentfulStatusCode> = {
  answered: 200,
  no_suitable_agent: 200,
  invalid_request: 400,
  routing_failed: 502,
  agent_unavailable: 502,
  discovery_unavailable: 503,
};

/** Build the Hono app. Dependencies are injected for testability. */
export function createApp(deps: RouterDeps): Hono {
  const app = new Hono();

  app.get('/', (c) => c.html(DEMO_PAGE_HTML));

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'ens-ai-agent-router',
      directoryName: deps.config.ens.directoryName,
      llmConfigured: deps.llm !== null,
      allowLocalhostEndpoints: deps.config.allowLocalhostEndpoints,
    }),
  );

  app.get('/agents', async (c) => {
    try {
      // Live ENS discovery (read-only, same validated path used for routing).
      const discovery = await discoverAgents(deps.ens, deps.config.ens.directoryName, {
        allowInsecureLocalhost: deps.config.allowLocalhostEndpoints,
        cacheTtlMs: deps.config.discoveryCacheTtlMs,
        logger: deps.logger,
      });
      return c.json({
        directoryName: discovery.directoryName,
        discoveredAgentIds: discovery.agents.map((agent) => agent.id),
        agents: discovery.agents.map((agent) => ({
          id: agent.id,
          ensName: agent.ensName,
          displayName: agent.displayName,
          description: agent.description,
          capabilities: agent.capabilities,
          endpoint: agent.endpoint,
          version: agent.version,
          inputDescription: agent.inputDescription,
        })),
        skipped: discovery.skipped,
      });
    } catch (cause) {
      return c.json(
        {
          status: 'discovery_unavailable',
          message: 'Agent discovery is unavailable.',
          detail: describeError(cause),
        },
        503,
      );
    }
  });

  app.get('/routing-log', (c) => c.json({ entries: deps.logger.entries() }));

  app.post('/route', async (c) => {
    // Untrusted input: the body must be valid JSON before anything else.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { status: 'invalid_request', message: 'Request body must be valid JSON.' },
        400,
      );
    }

    const result = await routeRequest(body, deps);
    return c.json(result, HTTP_STATUS_BY_ROUTE_STATUS[result.status]);
  });

  return app;
}

/**
 * Start the router as a standalone process:
 * loads configuration from the environment, builds the live ENS gateway and
 * LLM client, and serves the app.
 */
export function startRouter(): void {
  const config = loadRouterConfig(process.env);

  const ens = createViemEnsGateway({
    rpcUrl: config.ens.rpcUrl,
    ...(config.ens.universalResolverAddress !== null
      ? { universalResolverAddress: config.ens.universalResolverAddress }
      : {}),
  });

  // The LLM API key (SECRET) is used only inside the client's Authorization
  // header — it is never logged or exposed.
  const llm =
    config.llm.apiKey === null
      ? null
      : createOpenAiCompatibleLlmClient({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          model: config.llm.model,
          timeoutMs: config.llm.timeoutMs,
          jsonMode: config.llm.jsonMode,
        });

  const logger = createRoutingLogger();
  const app = createApp({ config, ens, llm, logger });

  const server = serve({ fetch: app.fetch, port: config.port });

  console.info(
    JSON.stringify({
      level: 'info',
      scope: 'router',
      message: `ENS agent router listening on port ${config.port}`,
      env: config.nodeEnv,
      directoryName: config.ens.directoryName,
      llmConfigured: llm !== null,
      allowLocalhostEndpoints: config.allowLocalhostEndpoints,
    }),
  );

  const shutdown = (): void => {
    console.info(JSON.stringify({ level: 'info', scope: 'router', message: 'Shutting down.' }));
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
