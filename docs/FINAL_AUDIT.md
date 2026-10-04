# Competition Audit

**Problem 3 — "Which AI Should Answer This?"**
Audited as an independent grader: claims, comments, and test names were not trusted; the actual source, tracked files, git history, and runtime behavior were inspected.

## Summary

Overall status: **PASS** (after remediation; see "Initial findings" below)

- **Official score: 80 / 80 — 9/9 checks passing.**
- Architecture verified by static source inspection AND behavioral tests (fake ENS data, fake LLM, real downstream HTTP servers, exact-URL assertions).
- ENS publication status: **NOT YET PUBLISHED** — the implementation is ready, but real Sepolia ENS names/text records have not been published yet (`.env.example` contains only the placeholder `agent-directory.your-ens-name.eth`; no `.env` exists).

### Initial findings (fixed during this audit)

| Finding | File | Fix |
| - | - | - |
| The entire implementation was **untracked** in git (only README/docs were tracked); CHECK 8 requires the routing-case fixture to be tracked | `git ls-files` | All files committed to git |
| No behavioral **dynamic fourth-agent** test | `tests/routing/pipeline.test.ts` | Added: directory A,B,C → A,B,C,D with zero code change; D becomes routable end-to-end |
| No ENS **re-point adversarial test** (CHECK 2) | `tests/routing/pipeline.test.ts` | Added: ENS metadata change → router calls the new URL, no router modification |
| Localhost exception defaulted to `true` even in `NODE_ENV=production` (potential production SSRF vector) | `src/config.ts` | Hardened: exception is **always forced off in production**, regardless of `ALLOW_LOCALHOST_ENDPOINTS`; regression test added (`tests/config.test.ts`) |
| CHECK 1 adversarial test used a generic hallucinated id instead of the official `totally-invented-agent` example | `tests/routing/pipeline.test.ts` | Test now uses the exact official adversarial payload |

## Official 80-point checks

| # | Check                              | Points | Evidence           | Result    |
| - | ---------------------------------- | -----: | ------------------ | --------- |
| 1 | Model choice membership validation |     20 | `src/router/routing.ts:58-76` (`validateRoutingDecision` — explicit membership check against `discoveredAgents`, unknown choice throws `ModelSelectedUnknownAgentError` before any endpoint is called); tests `tests/routing/decision.test.ts`, `tests/routing/pipeline.test.ts` ("totally-invented-agent" → 0 HTTP calls, explicit `routing_failed`, no fallback) | PASS |
| 2 | ENS-derived forwarding URL         |     14 | `src/router/forwarding.ts:65-97` (`buildInvokeUrl(agent.endpointUrl)` — the only URL source); branded type `AgentEndpointUrl` produced only by `validateAgentEndpoint` (`src/security/endpoint.ts:70`); behavioral tests assert the exact URL called and re-pointing via ENS-only change | PASS |
| 3 | No literal agent list              |     10 | ripgrep/grep sweep of `src/**` and `public/**` found zero agent ids/names/endpoint maps/switch-on-agent-id; discovery is anchored on the single ENS directory record (`src/ens/directory.ts`, `agents.directory` text record); agent names appear only in tests, fixtures, `agents/**`, and publishing tooling | PASS |
| 4 | Malformed record skipped           |      8 | `src/router/discovery.ts:92` uses `Promise.allSettled` per agent; `src/ens/records.ts:111` uses `Promise.allSettled` per record; tests cover missing id, missing endpoint, invalid endpoint, invalid capabilities, malformed directory JSON, unresolvable name, duplicates — discovery never aborts | PASS |
| 5 | Explicit timeout                   |      7 | `src/router/forwarding.ts:84-96,166-169` — `AbortController` + `setTimeout` → `controller.abort()`, `signal` passed into `fetch`, `clearTimeout` in `finally`; behavioral test: a never-responding agent is aborted within the configured timeout; same pattern applied to LLM calls (`src/llm/client.ts:62-80`) | PASS |
| 6 | HTTPS validation                   |      4 | `src/security/endpoint.ts:87-107` — URL parsed, explicit protocol allow-list (`https:`/`http:`), `http:` only for exact loopback hosts (`localhost`, `127.0.0.1`) and only when the development exception is enabled (forced OFF in production); `file:`/`ftp:`/`javascript:`/`data:`/`gopher:`/credential-embedded URLs all rejected by tests; validation runs before registry admission, i.e. before any forwarding | PASS |
| 7 | Explicit no-agent response         |      6 | `src/router/router.ts:255-265` — explicit `no_suitable_agent` branch returning `{ status, message, attribution: null }`; test: weather request → `no_suitable_agent`, zero HTTP calls, no default/random/first-agent choice | PASS |
| 8 | Expected routing cases             |      6 | `fixtures/routing-cases.json` — 11 cases, every case with `id` + `request` + `expectedAgent` (or `null`); covers overdue invoice → `invoice-specialist`, contract question → `contract-specialist`, brand copy → `brand-specialist`, weather → `null`; **file is now tracked by git** (it was untracked at audit start) | PASS |
| 9 | No credentials                     |      5 | `git ls-files` scan + `npm run secret:scan` (57 files) — zero credential-shaped patterns; `git log --all -p` inspected — no secrets in history; `.env.example` contains placeholders only; `.gitignore` ignores `.env`, `*.pem`, `*.key`, logs | PASS |

**Score: 80 / 80.**

## Additional security findings

| Severity | File | Issue | Impact | Recommended fix | Status |
| - | - | - | - | - | - |
| Medium | `src/config.ts` | `ALLOW_LOCALHOST_ENDPOINTS` defaulted to `true` even in production | In production, an ENS agent record could point at `http://localhost:…` / `http://127.0.0.1:…`, enabling SSRF against local services | Force the exception off when `NODE_ENV=production` | **FIXED** in this audit (`src/config.ts`, regression test `tests/config.test.ts`) |
| Low (residual, accepted) | `src/security/endpoint.ts` | HTTPS endpoints on private/RFC1918 or link-local IPs (e.g. `https://10.0.0.5`, `https://169.254.169.254`) are not separately blocked | A directory owner could point an agent at an internal HTTPS service | Acceptable for the challenge scope (protocol allow-list + loopback restriction are the graded requirements); a production deployment could add a private-IP blocklist | Documented |
| Low | `src/llm/prompt.ts` | Prompt-injection defenses are prompt-level only | A malicious agent description could try to steer the model | Already mitigated architecturally: the model never receives endpoints, output is Zod-validated (`{"agentId": string|null}`, unknown keys stripped), and membership is re-enforced in code. Verified by test `tests/routing/pipeline.test.ts` (polluted description) | Mitigated |
| Info | `src/router/forwarding.ts` | Downstream agent responses are Zod-validated; attribution is taken from the router's ENS-selected record, never `response.agent.name` | A lying agent cannot spoof attribution | Verified by test ("never trusts the agent self-claimed identity for attribution") | Mitigated |
| Info | `src/router/routing.ts` | No accidental fallback: `llm === null` → explicit failure; no `defaultAgent`/`fallbackAgent`/`agents[0]`/random selection anywhere in `src/` | — | Grep-verified: zero matches outside tests | Mitigated |

## Tests executed

| Command | Result |
| - | - |
| `npm install` | OK — 0 vulnerabilities |
| `npm test` | **10 files, 91 tests, all passed** (84 before remediation) |
| `npm run audit` | **AUDIT PASSED — all 9 checks + LLM check** |
| `npm run build` | OK (tsc, no errors) |
| `npm run lint` (`npm run typecheck`) | OK (tsc, no errors) |
| `npm run secret:scan` | OK — 57 files scanned, 0 findings |
| `git log --all -p` secret sweep | No secrets found in history |
| ripgrep/grep static sweeps (`agent`, `endpoint`, `https://`, `localhost`, `127.0.0.1`, `AGENT_`, `defaultAgent`, `fallback`, `switch`, `fetch(`, etc.) | All relevant occurrences manually inspected; no violations |

New/changed behavioral tests added during the audit:

- `tests/routing/pipeline.test.ts` — dynamic fourth agent becomes routable with zero router-code change; ENS re-point changes the forwarded URL; `totally-invented-agent` rejected with zero HTTP calls.
- `tests/config.test.ts` — localhost exception forced off in production; env validation.

## ENS deployment status

**NOT YET PUBLISHED.**

- The router is wired for a real Sepolia ENS read path via viem + the Universal Resolver (`src/ens/client.ts`).
- The publisher for real ENS text-record writes exists (`scripts/publish-agents.ts`), driven by `scripts/agents.config.ts`.
- However, the repository contains only placeholder/fake ENS names (`agent-directory.your-ens-name.eth`, `*.test.eth`, `example.eth`), no `.env`, and no published transaction hashes.
- **Implementation ready, ENS publication still required.** To go live: copy `.env.example` → `.env`, register/own a Sepolia ENS name, set `ENS_DIRECTORY_NAME`, run `npm run publish:agents`, and point `agent.endpoint` records at public HTTPS URLs.

## Audit-script reliability assessment

`npm run audit` (`scripts/audit.ts`) was itself inspected:

- It performs real pattern-based source inspection with file:line evidence and exits non-zero on failure — not a rubber stamp.
- False-positive risk identified: it greps for the *presence* of security patterns (e.g. `validateRoutingDecision`, `Promise.allSettled`), so an architecturally broken app could still satisfy the patterns. That is why the behavioral tests above (exact-URL assertions, no-call assertions, timeout test, fourth-agent test) are the primary evidence; the audit script is treated as a supplement only.
- False-negative risk: it scans `src/**` and `public/**` only. `scripts/dev.ts` (a dev process orchestrator that mentions agent names but performs no routing) is outside its scope but was manually verified clean.
- No changes to the audit script were required.

## Final verdict

**READY FOR SUBMISSION** — with the explicit caveat that **real Sepolia ENS publication is still required** before a live demo: all 9 official checks pass on the actual implementation (80/80), the test suite and audit pass, no credentials exist in tracked files or git history, and dynamic ENS discovery is proven behaviorally.
