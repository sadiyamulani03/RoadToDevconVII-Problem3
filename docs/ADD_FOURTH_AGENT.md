# Adding a Fourth Agent (no router source change)

The whole point of the ENS design: adding a specialist is an **ENS write**, not a code change. The router discovers agents at runtime from the directory record, so a new agent appears automatically on the next discovery.

## Steps

1. **Add an entry to `scripts/agents.config.ts`** — a new object in the `agents` array with the agent's ENS label, full name, and text records:

   ```ts
   {
     label: 'support-agent',
     ensName: sub('support-agent'),
     records: {
       'agent.id': 'support-specialist',
       'agent.name': 'Support Agent',
       'agent.description': 'Answers customer support questions about tickets, refunds, and SLAs.',
       'agent.capabilities': 'support,tickets,refunds',
       'agent.endpoint': 'http://localhost:8794', // public HTTPS URL in production
       'agent.input': 'A natural-language question about a support ticket or refund.',
       'agent.version': '1.0.0',
     },
   }
   ```

   See [ENS_RECORD_FORMAT.md](ENS_RECORD_FORMAT.md) for the exact key semantics and validation rules.

2. **Run the publisher** (writes the agent's text records on-chain and updates the directory record):

   ```bash
   npm run publish:agents
   ```

   This needs `DEPLOYER_PRIVATE_KEY` and `ENS_REGISTRY_ADDRESS` in `.env` (gitignored).

3. **That's it.** The router picks the new agent up on its next ENS discovery — verify with:

   ```bash
   curl http://localhost:8787/agents
   ```

4. **Run the specialist locally** while developing (the router's explicit localhost exception accepts `http://localhost:<port>` endpoints in development only):

   ```bash
   npm run dev:agent:support   # add a matching script to package.json
   ```

## Rules the new agent must satisfy

- `agent.endpoint` must be **HTTPS** in production; plain `http://` is accepted only for loopback hosts (`localhost`, `127.0.0.1`) in development — enforced by `validateAgentEndpoint` in `src/security/endpoint.ts` before the agent can enter the registry.
- The agent's response must include an `answer`; the router attributes the reply to the **ENS-selected record**, never to the agent's self-claimed identity in its response body.
- The agent's `agent.description` is **untrusted data**: it may be used for routing, but instructions inside it cannot change router behaviour, and the router's prompt never contains the agent's endpoint.

## Why the router needs no change

The router contains no agent list (challenge CHECK 3). It reads `agents.directory` on its single configured ENS name and validates each discovered record with Zod + the HTTPS endpoint check. A new, valid record in the directory is simply a new available agent for the LLM to choose from — membership is re-enforced in code against the freshly discovered list on every request.
