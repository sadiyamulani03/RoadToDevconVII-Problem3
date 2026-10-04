/**
 * HTTP API tests for the router server (POST /route, GET /agents, /health,
 * /routing-log) with injected fakes for ENS + LLM and a real downstream server.
 */
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.js';
import {
  FakeEnsGateway,
  FakeLlmClient,
  FakeLogger,
  makeConfig,
  makeRawRecords,
  startDownstreamServer,
} from '../helpers.js';
import { clearDiscoveryCache } from '../../src/router/discovery.js';

function makeGateway(downstreamUrl: string): FakeEnsGateway {
  const gateway = new FakeEnsGateway();
  gateway.setDirectory(['invoice-agent.test.eth', 'brand-agent.test.eth']);
  gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords({ endpoint: downstreamUrl }));
  gateway.setAgentRecords(
    'brand-agent.test.eth',
    makeRawRecords({
      id: 'brand-specialist',
      name: 'Brand Copy Agent',
      description: 'Writes brand copy.',
      capabilities: 'branding,copywriting',
      endpoint: 'https://brand-agent.test.example',
    }),
  );
  return gateway;
}

describe('router HTTP API', () => {
  it('POST /route returns an answered response with ENS attribution', async () => {
    clearDiscoveryCache();
    const downstream = await startDownstreamServer();
    try {
      const app = createApp({
        config: makeConfig(),
        ens: makeGateway(downstream.url),
        llm: new FakeLlmClient('{"agentId": "invoice-specialist"}'),
        logger: new FakeLogger(),
      });

      const response = await app.request('/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Which invoice is overdue?' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['status']).toBe('answered');
      expect(body['requestId']).toBeTruthy();
      const attribution = body['attribution'] as Record<string, unknown>;
      expect(attribution['agentId']).toBe('invoice-specialist');
      expect(attribution['ensName']).toBe('invoice-agent.test.eth');
      expect(attribution['displayName']).toBe('Invoice Assistant');
    } finally {
      await downstream.close();
    }
  });

  it('POST /route returns an explicit no_suitable_agent response', async () => {
    clearDiscoveryCache();
    const downstream = await startDownstreamServer();
    try {
      const app = createApp({
        config: makeConfig(),
        ens: makeGateway(downstream.url),
        llm: new FakeLlmClient('{"agentId": null}'),
        logger: new FakeLogger(),
      });

      const response = await app.request('/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: "What's the weather in Mumbai tomorrow?" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['status']).toBe('no_suitable_agent');
      expect(body['message']).toBe('No suitable agent was found for this request.');
      expect(body['attribution']).toBeNull();
    } finally {
      await downstream.close();
    }
  });

  it('POST /route rejects malformed JSON and invalid requests', async () => {
    const app = createApp({
      config: makeConfig(),
      ens: new FakeEnsGateway(),
      llm: new FakeLlmClient('{"agentId": null}'),
      logger: new FakeLogger(),
    });

    const malformed = await app.request('/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    const malformedBody = (await malformed.json()) as Record<string, unknown>;
    expect(malformedBody['status']).toBe('invalid_request');

    const empty = await app.request('/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(empty.status).toBe(400);
  });

  it('POST /route returns 502 when the routing model is not configured', async () => {
    clearDiscoveryCache();
    const downstream = await startDownstreamServer();
    try {
      const app = createApp({
        config: makeConfig(),
        ens: makeGateway(downstream.url),
        llm: null,
        logger: new FakeLogger(),
      });

      const response = await app.request('/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Which invoice is overdue?' }),
      });

      expect(response.status).toBe(502);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['failureReason']).toBe('llm_not_configured');
    } finally {
      await downstream.close();
    }
  });

  it('GET /agents returns the discovered agents from ENS', async () => {
    clearDiscoveryCache();
    const app = createApp({
      config: makeConfig(),
      ens: makeGateway('https://invoice-agent.test.example'),
      llm: null,
      logger: new FakeLogger(),
    });

    const response = await app.request('/agents');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      directoryName: string;
      discoveredAgentIds: string[];
      agents: Array<{ id: string; ensName: string }>;
    };
    expect(body.directoryName).toBe('agent-directory.test.eth');
    expect(body.discoveredAgentIds).toEqual(['invoice-specialist', 'brand-specialist']);
    expect(body.agents[0]?.ensName).toBe('invoice-agent.test.eth');
  });

  it('GET /health reports liveness and configuration (no secrets)', async () => {
    const app = createApp({
      config: makeConfig(),
      ens: new FakeEnsGateway(),
      llm: new FakeLlmClient('{"agentId": null}'),
      logger: new FakeLogger(),
    });

    const response = await app.request('/health');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('test-key-not-real');
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
  });

  it('GET /routing-log exposes safe telemetry', async () => {
    clearDiscoveryCache();
    const downstream = await startDownstreamServer();
    try {
      const logger = new FakeLogger();
      const app = createApp({
        config: makeConfig(),
        ens: makeGateway(downstream.url),
        llm: new FakeLlmClient('{"agentId": "invoice-specialist"}'),
        logger,
      });

      await app.request('/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Which invoice is overdue?' }),
      });

      const response = await app.request('/routing-log');
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        entries: Array<Record<string, unknown>>;
      };
      expect(body.entries.length).toBe(1);
      const entry = body.entries[0] ?? {};
      expect(entry['finalStatus']).toBe('answered');
      expect(entry['validatedSelectedAgentId']).toBe('invoice-specialist');
      expect(JSON.stringify(body)).not.toContain('test-key-not-real');
    } finally {
      await downstream.close();
    }
  });

  it('GET / serves the demo UI', async () => {
    const app = createApp({
      config: makeConfig(),
      ens: new FakeEnsGateway(),
      llm: null,
      logger: new FakeLogger(),
    });
    const response = await app.request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});
