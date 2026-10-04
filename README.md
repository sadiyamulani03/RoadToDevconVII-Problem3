# The Router That Doesn't Guess

**ENS-based AI agent router** — one ENS name is the whole agent directory. The router never hardcodes, env-vars, or hallucinates an agent list; it discovers specialists at runtime from ENS text records on Sepolia.

## Problem

An AI agent router that picks a specialist for a user request needs to know which specialists exist. The usual approach is a hardcoded list in source or a config file — which means adding an agent requires a code change and a redeploy, and the router trusts whatever the developer remembered to write down.

## Solution

Every specialist agent publishes its metadata (id, name, description, capabilities, HTTPS endpoint) as **ENS text records** on its own Sepolia name. The router is configured with exactly **one** ENS identity — the directory name — and reads the agent list from that name's `agents.directory` text record at runtime.

For each client request the router:

1. Discovers agents from the ENS directory record and validates every record (Zod schema + HTTPS endpoint check). Malformed records are **skipped**, never fatal.
2. Asks an LLM to pick **one agent id** from the discovered list — the LLM sees only validated metadata, **never endpoints** — and the prompt is explicit that agent metadata is untrusted data.
3. **Independently validates** the model's choice against the discovered list in code (the model may not invent an agent).
4. Forwards the request to the selected agent's **ENS-derived endpoint** with an explicit timeout.
5. Returns a structured answer attributed to the ENS-selected agent — the agent's self-claimed identity in its response body is never trusted for attribution.

If no agent fits, the router returns an explicit `no_suitable_agent` response — never a default, random, or fallback agent.

## Why ENS

ENS text records are on-chain, public, and owned by whoever controls the name. Publishing a fourth agent is an ENS write, not a code change: add a record, and the router picks it up on its next discovery — no router source change, no redeploy.

## The 9 challenge checks

| Check | Property | Where |
| ----- | -------- | ----- |
| 1 | Routing decision is membership-validated against the ENS-discovered list | `src/router/routing.ts` |
| 2 | Forwarded URL comes exclusively from the selected agent's validated ENS record | `src/router/forwarding.ts` |
| 3 | Router source contains no literal agent list | `src/**`, `public/**` (agents come from ENS at runtime) |
| 4 | Malformed ENS records are skipped (Zod + per-agent `Promise.allSettled`) | `src/ens/records.ts`, `src/router/discovery.ts` |
| 5 | Explicit downstream timeout on every router → agent call | `src/router/forwarding.ts` |
| 6 | ENS endpoints must be HTTPS (explicit localhost exception) | `src/security/endpoint.ts` |
| 7 | Explicit `no_suitable_agent` response | `src/router/router.ts` |
| 8 | Recorded routing cases include the expected agent | `fixtures/routing-cases.json` |
| 9 | Zero real credentials in tracked files | `.env.example` placeholders only |

A static audit of all of these runs with `npm run audit` — it inspects actual source files with targeted patterns and exits non-zero on any failure.

## Quick start

```bash
npm install

# configure (Sepolia RPC + your ENS directory name + LLM key)
cp .env.example .env   # then fill in the values

# publish the three specialists to your ENS directory name
npm run publish:agents

# run everything locally (router + 3 specialist agents)
npm run dev
```

The router serves:

| Endpoint | Purpose |
| -------- | ------- |
| `POST /route` | Route a client request (the primary API) |
| `GET /agents` | Currently discovered, validated agents (live ENS read) |
| `GET /routing-log` | Safe routing telemetry |
| `GET /health` | Liveness |
| `GET /` | Demo UI |

```bash
curl -X POST http://localhost:8787/route \
  -H 'content-type: application/json' \
  -d '{"message": "Which invoice is overdue?"}'
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map and request flow, [docs/ENS_RECORD_FORMAT.md](docs/ENS_RECORD_FORMAT.md) for the exact ENS text-record keys, [docs/TESTING.md](docs/TESTING.md) for the test suite, and [docs/ADD_FOURTH_AGENT.md](docs/ADD_FOURTH_AGENT.md) for adding a fourth specialist without touching router source.

## Security model

- **ENS records are untrusted data.** Every record is Zod-validated and its endpoint is checked (HTTPS required; plain `http://` is accepted only for loopback hosts in development) before an agent can enter the registry.
- **The prompt never contains endpoints.** The LLM receives only id / name / description / capabilities, delimited as untrusted data; prompt-injection attempts in agent descriptions are delivered as inert text and cannot change routing behaviour.
- **The model's choice is not a security boundary.** Membership in the discovered list is re-enforced in code before any endpoint is called.
- **Attribution is router-validated.** The answer is attributed to the ENS-selected agent, never to an agent's self-claimed identity.
- **Secrets stay out of the repo.** The LLM API key and deployer key live only in the gitignored `.env`; the API key is used solely in Authorization headers and never logged.

## Testing

```bash
npm test        # vitest — 10 files, 91 tests
npm run audit   # static competition audit (all 9 checks)
npm run build   # tsc -p tsconfig.build.json
npm run verify:ens   # live Sepolia ENS verification (needs .env with SEPOLIA_RPC_URL + ENS_DIRECTORY_NAME)
```
