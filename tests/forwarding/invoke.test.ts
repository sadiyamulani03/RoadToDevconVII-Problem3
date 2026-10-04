/**
 * CHECK 2 + CHECK 5 — downstream forwarding.
 *
 * Proves the forwarded URL comes ONLY from the ENS-derived validated record,
 * and every call carries an explicit AbortController timeout.
 */
import { describe, expect, it } from 'vitest';

import {
  AGENT_REQUEST_TIMEOUT_MS,
  buildInvokeUrl,
  invokeAgent,
} from '../../src/router/forwarding.js';
import { makeAgent, makeRawRecords, startDownstreamServer } from '../helpers.js';

describe('buildInvokeUrl (CHECK 2)', () => {
  it('appends /invoke to the validated endpoint', () => {
    const agent = makeAgent();
    const url = buildInvokeUrl(agent.endpointUrl);
    expect(url.href).toBe('https://invoice-agent.test.example/invoke');
  });

  it('handles a base path with and without a trailing slash', () => {
    const withSlash = buildInvokeUrl(makeAgent({ endpoint: 'https://agent.example.com/base/' }).endpointUrl);
    const withoutSlash = buildInvokeUrl(makeAgent({ endpoint: 'https://agent.example.com/base' }).endpointUrl);
    expect(withSlash.href).toBe('https://agent.example.com/base/invoke');
    expect(withoutSlash.href).toBe('https://agent.example.com/base/invoke');
  });

  it('works for the localhost development exception', () => {
    const url = buildInvokeUrl(makeAgent({ endpoint: 'http://127.0.0.1:8793' }).endpointUrl);
    expect(url.href).toBe('http://127.0.0.1:8793/invoke');
  });
});

describe('invokeAgent (CHECK 2 + CHECK 5)', () => {
  it('posts to the ENS-derived URL with the standardized contract', async () => {
    const downstream = await startDownstreamServer();
    try {
      const agent = makeAgent({ endpoint: downstream.url });
      const result = await invokeAgent(agent, { requestId: 'req-123', message: 'Which invoice is overdue?' });

      expect(result.ok).toBe(true);
      expect(result.answer).toContain('INV-2026-001');
      expect(result.claimedAgent?.id).toBe('invoice-specialist');
      expect(result.identityMismatch).toBe(false);

      // CHECK 2: the request went to the ENS-derived endpoint, nothing else.
      expect(downstream.requests).toHaveLength(1);
      expect(downstream.requests[0]?.url).toBe(`${downstream.url}/invoke`);
      expect(downstream.requests[0]?.method).toBe('POST');
      expect(downstream.requests[0]?.body).toMatchObject({ requestId: 'req-123' });
    } finally {
      await downstream.close();
    }
  });

  it('times out cleanly when the agent never responds (CHECK 5)', async () => {
    const downstream = await startDownstreamServer(() => {
      // Intentionally never responds.
    });
    try {
      const agent = makeAgent({ endpoint: downstream.url });
      const startedAt = Date.now();
      const result = await invokeAgent(agent, { requestId: 'req-123', message: 'hello' }, 150);
      const elapsed = Date.now() - startedAt;

      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe('timeout');
      expect(elapsed).toBeLessThan(5_000); // aborted by the explicit timeout
    } finally {
      await downstream.close();
    }
  });

  it('handles a downstream 500 cleanly', async () => {
    const downstream = await startDownstreamServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    try {
      const result = await invokeAgent(makeAgent({ endpoint: downstream.url }), {
        requestId: 'req-123',
        message: 'hello',
      });
      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe('http_error');
      expect(result.httpStatus).toBe(500);
    } finally {
      await downstream.close();
    }
  });

  it('handles malformed downstream JSON cleanly', async () => {
    const downstream = await startDownstreamServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not valid json at all');
    });
    try {
      const result = await invokeAgent(makeAgent({ endpoint: downstream.url }), {
        requestId: 'req-123',
        message: 'hello',
      });
      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe('malformed_response');
    } finally {
      await downstream.close();
    }
  });

  it('handles a structurally invalid downstream response cleanly', async () => {
    const downstream = await startDownstreamServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ foo: 1, noAnswerHere: true }));
    });
    try {
      const result = await invokeAgent(makeAgent({ endpoint: downstream.url }), {
        requestId: 'req-123',
        message: 'hello',
      });
      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe('malformed_response');
    } finally {
      await downstream.close();
    }
  });

  it('handles a connection failure cleanly', async () => {
    // Port 1 on 127.0.0.1: connection refused (nothing listens there).
    const result = await invokeAgent(makeAgent({ endpoint: 'http://127.0.0.1:1' }), {
      requestId: 'req-123',
      message: 'hello',
    }, 1_000);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe('network_error');
  });

  it('exports the explicit timeout constant (8000 ms)', () => {
    expect(AGENT_REQUEST_TIMEOUT_MS).toBe(8_000);
  });
});
