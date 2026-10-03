# ENS Record Format

The router reads **two kinds** of ENS text records on Sepolia:

1. one **directory record** on the configured directory name, and
2. **agent records** on each specialist's own name.

All values are plain UTF-8 text records (ENSIP-5). Nothing is stored on-chain beyond text records.

## Directory record

Published on the router's configured ENS name (`ENS_DIRECTORY_NAME`, e.g. `agent-directory.your-ens-name.eth`):

| Key | Value |
| --- | ----- |
| `agents.directory` | JSON: `{"version": 1, "agents": ["contract-agent", "brand-agent", "invoice-agent"]}` |

- `agents` is a list of **ENS labels** under the directory name (each label + `.` + directory name is the agent's full name).
- The router is configured with this **single** ENS identity and nothing else — there is no agent list in router source (challenge CHECK 3).

## Agent records

Published on each agent's name (e.g. `invoice-agent.agent-directory.your-ens-name.eth`):

| Key | Required | Value | Notes |
| --- | -------- | ----- | ----- |
| `agent.id` | yes | `invoice-specialist` | Stable machine id; the id the LLM chooses and the router validates |
| `agent.name` | yes | `Invoice Assistant` | Human-readable display name |
| `agent.description` | yes | `Answers questions about invoices...` | Untrusted data — used for routing only; the prompt treats it as data, not instructions |
| `agent.capabilities` | yes | `invoices,billing,overdue` | Comma-separated capability tags |
| `agent.endpoint` | yes | `https://agent.example/invoke-base` | **HTTPS required** (challenge CHECK 6). Plain `http://` is accepted only for loopback hosts (`localhost`, `127.0.0.1`) in development |
| `agent.input` | no | `A natural-language question about invoices.` | Description of the expected input |
| `agent.version` | no | `1.0.0` | Agent metadata version |

The single authoritative schema lives in `src/ens/records.ts` (`AgentRecordSchema` — Zod).

## Validation rules (what makes a record "valid")

- Every field is validated with `AgentRecordSchema.safeParse`; missing required fields, wrong types, or extra unknown fields make the record **invalid**.
- `agent.endpoint` is additionally validated by `validateAgentEndpoint` in `src/security/endpoint.ts` **before** the agent can enter the registry: URL parsing via the `URL` class, `https:` required, protocol allow-list (no `file:`, `ftp:`, `javascript:`, `data:`), and the explicit loopback exception for development.
- A malformed or unresolvable record **skips exactly that agent** (per-agent `Promise.allSettled`) — it never aborts discovery (challenge CHECK 4).

## Publishing

`scripts/publish-agents.ts` (run via `npm run publish:agents`) writes these records on-chain for the three specialists defined in `scripts/agents.config.ts`, then updates the directory record. It requires `DEPLOYER_PRIVATE_KEY` and `ENS_REGISTRY_ADDRESS` in `.env` (gitignored — never committed).

The router itself needs **no** private key: it only reads text records through the Sepolia ENS resolver (`src/ens/client.ts`).
