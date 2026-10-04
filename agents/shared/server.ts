/**
 * Shared HTTP runtime for specialist agents.
 *
 * Each agent exposes POST /invoke (the standardized downstream contract) and
 * GET /health. Request bodies are untrusted data and validated with Zod.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { InvokeRequestSchema, type AgentDefinition } from './protocol.js';
import { summarizeIssues } from '../../src/validation.js';
import { safeTruncate } from '../../src/security/secrets.js';

/** Start a specialist agent as a standalone HTTP server. */
export function startAgentServer(definition: AgentDefinition): void {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({ status: 'ok', agent: definition.identity, version: definition.version }),
  );

  app.post('/invoke', async (c) => {
    // Untrusted input: the body must be valid JSON and match the contract.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const parsed = InvokeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid invoke request.', issues: summarizeIssues(parsed.error) },
        400,
      );
    }

    try {
      const answer = await definition.handle(parsed.data);
      return c.json({
        answer,
        // The claimed identity mirrors this agent's ENS-published id/name.
        agent: { id: definition.identity.id, name: definition.identity.name },
      });
    } catch (cause) {
      return c.json(
        {
          error: 'The agent failed to handle the request.',
          detail: safeTruncate(cause instanceof Error ? cause.message : String(cause), 300),
        },
        500,
      );
    }
  });

  const server = serve({ fetch: app.fetch, port: definition.port });

  console.info(
    JSON.stringify({
      level: 'info',
      scope: 'agent',
      message: `Agent "${definition.identity.id}" listening on port ${definition.port}`,
      agent: definition.identity,
    }),
  );

  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
