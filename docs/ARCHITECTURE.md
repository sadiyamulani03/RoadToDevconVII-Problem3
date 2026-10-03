# Architecture

## Module map

```
src/
  config.ts                  Router configuration from env (validated; no agent URLs)
  validation.ts              Client request validation (untrusted input)
  security/
    endpoint.ts              validateAgentEndpoint: URL parsing, https-only,
                             protocol allow-list, explicit loopback exception
    secrets.ts               safeTruncate / describeError / readOptionalEnv
  ens/
    client.ts                EnsGateway (viem, Sepolia resolver, read-only)
    directory.ts             reads the single agents.directory record
    records.ts               AgentRecordSchema (Zod) + per-record allSettled reads
    names.ts                 ENSIP-15 name normalization
    lookup-error.ts          EnsLookupError
  llm/
    client.ts                OpenAI-compatible client with explicit AbortController timeout
    prompt.ts                Routing prompt builder (constrained view, untrusted data markers)
    schema.ts                RoutingDecisionSchema (Zod) — model output validation
    parse-decision.ts        parse + validate the model's JSON decision
  router/
    discovery.ts             ENS discovery (per-agent Promise.allSettled, malformed skipped)
    routing.ts               validateRoutingDecision (CHECK 1 membership check in code)
    forwarding.ts            invokeAgent: URL only from agent.endpointUrl, explicit timeout
    router.ts                routeRequest: the full pipeline
  observability/
    routing-log.ts           safe routing telemetry (no secrets)
  server/
    app.ts                   Hono app: POST /route, GET /agents, /routing-log, /health, /
    demo-page.ts             demo UI
    main.ts                  standalone entrypoint
  agents/
    types.ts                 DiscoveredAgent, RawAgentRecords, LlmAgentView (no endpoint)
agents/                      the three specialist agents (NOT router source)
scripts/                     publishing + audit tooling (NOT router source)
```

## Request flow

```
client request
  |
  v
validate client request            (src/validation.ts)      -> invalid_request on failure
  |
  v
discover agents from ENS           (src/router/discovery.ts)
  |  - read agents.directory on the configured name (src/ens/directory.ts)
  |  - resolve + validate each agent's records (src/ens/records.ts, Zod)
  |  - per-agent Promise.allSettled: one malformed record skips one agent, never fatal
  |  -> discovery_unavailable when no valid agents were discovered
  |
  v
LLM routing decision               (src/llm/prompt.ts, client.ts, schema.ts)
  |  - the prompt contains ONLY id / name / description / capabilities (no endpoints)
  |  - agent metadata + client request delimited as UNTRUSTED DATA
  |  - the LLM must choose one provided id or null
  |  - the raw JSON output is Zod-validated (RoutingDecisionSchema, unknown keys stripped)
  |
  v
membership validation IN CODE      (src/router/routing.ts — CHECK 1)
  |  - discoveredAgents.find(agent => agent.id === decision.agentId)
  |  - model-invented ids rejected via ModelSelectedUnknownAgentError BEFORE any endpoint is called
  |  - agentId: null -> explicit no_suitable_agent response (CHECK 7, no fallback)
  |
  v
forward to the agent               (src/router/forwarding.ts — CHECK 2 + CHECK 5)
  |  - URL built exclusively from agent.endpointUrl (the validated ENS record)
  |  - AbortController + setTimeout abort + clearTimeout in finally
  |  - agent's self-claimed identity in the response body is NOT trusted
  |  -> agent_unavailable on timeout / failure
  |
  v
structured answer                  attributed to the ENS-selected agent
```

## Key design decisions

- **One ENS identity in the router.** The router is configured only with the directory name; the agent list is discovered at runtime (CHECK 3). `scripts/agents.config.ts` knows agent names, but it is publishing tooling, never imported by router source.
- **Prompt constraints are not a security boundary.** The LLM is told not to invent ids or output URLs, but the application independently re-enforces membership in code and builds the forwarded URL only from the validated ENS record.
- **Failure modes are explicit statuses**, never silent fallbacks: `invalid_request`, `routing_failed`, `agent_unavailable`, `discovery_unavailable`, `no_suitable_agent` — each with a client-facing message.
- **Dependency injection everywhere.** `routeRequest` takes `{ config, ens, llm, logger }`, so tests run the real pipeline against a fake ENS gateway, a canned LLM, and a real local HTTP downstream server.
