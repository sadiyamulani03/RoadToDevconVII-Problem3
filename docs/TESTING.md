# Testing

## Running

```bash
npm test          # vitest run — 9 files, 84 tests
npm run audit     # static competition audit (all 9 checks, file:line evidence)
npm run build     # tsc -p tsconfig.build.json
```

## Test files

| File | Covers |
| ---- | ------ |
| `tests/routing/pipeline.test.ts` | CHECK 1 + 2 + 7 — the full pipeline against a **real** downstream HTTP server: forwarded URL is the ENS-derived endpoint, model-invented agent ids rejected before any call, explicit `no_suitable_agent`, malicious descriptions delivered as data but membership enforced in code, attribution never trusts agent self-claims, no-agent and invalid-request branches |
| `tests/routing/decision.test.ts` | CHECK 1 — `validateRoutingDecision` membership validation against the discovered list |
| `tests/routing/server.test.ts` | HTTP API: `POST /route` status mapping, `GET /agents`, `GET /health`, invalid JSON bodies |
| `tests/routing-cases.test.ts` | CHECK 8 — every recorded case in `fixtures/routing-cases.json` routes to its `expectedAgent` (or null) |
| `tests/discovery/directory.test.ts` | Directory record parsing: valid, malformed, and missing `agents.directory` |
| `tests/discovery/records.test.ts` | CHECK 4 + 6 — per-record Zod validation, endpoint HTTPS rule, malformed records skipped without aborting discovery |
| `tests/forwarding/invoke.test.ts` | CHECK 2 + 5 — URL built only from `agent.endpointUrl`, explicit AbortController timeout, timeout/failure degradation |
| `tests/security/endpoint.test.ts` | CHECK 6 — URL parsing, https requirement, protocol allow-list, loopback exception |
| `tests/security/secrets.test.ts` | CHECK 9 — `safeTruncate`, `readOptionalEnv`, secret redaction helpers |

## Test doubles (`tests/helpers.ts`)

- **`FakeEnsGateway`** — in-memory ENS text records; can simulate unresolvable names and malformed directory values, and records every lookup for assertions.
- **`FakeLlmClient`** — returns a canned response (or throws) and records the exact messages it received, so prompt-content assertions are possible.
- **`FakeLogger`** — captures routing log entries and warnings.
- **`startDownstreamServer`** — a **real** local HTTP server on an ephemeral `127.0.0.1` port acting as a downstream specialist agent; captures full request URL/method/body.

Every fixture value is an obvious fake — no real credentials or authenticated URLs (the local servers use the router's explicit localhost exception, CHECK 6).

## What the suite proves

- The router calls **no endpoint** when the model invents an agent id, when no agent fits, or when the request is invalid.
- The forwarded URL is **exactly** the selected agent's ENS-derived endpoint + `/invoke`.
- Malformed ENS records never abort discovery — routing still works with the valid agents.
- Prompt-injection text in agent descriptions reaches the LLM only as inert data; the answer is still attributed to the ENS-selected agent and the prompt never contains endpoints.
- Attribution always uses the router's validated ENS record, even when the downstream agent lies about its identity in its response body.
- Timeouts on router → agent calls are explicit (`AbortController`), and degrade to `agent_unavailable` rather than hanging.
