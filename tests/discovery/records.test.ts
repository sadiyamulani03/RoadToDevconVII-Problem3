/**
 * CHECK 4 — malformed ENS records must be skipped.
 * Per-agent record validation + resilient discovery with Promise.allSettled.
 */
import { describe, expect, it } from 'vitest';

import { discoverAgents } from '../../src/router/discovery.js';
import { clearDiscoveryCache } from '../../src/router/discovery.js';
import {
  InvalidAgentEndpointError,
} from '../../src/security/endpoint.js';
import { AgentRecordValidationError } from '../../src/ens/records.js';
import { parseAgentRecord } from '../../src/ens/records.js';
import { FakeEnsGateway, FakeLogger, TEST_DIRECTORY_NAME, makeRawRecords } from '../helpers.js';

const ENDPOINT_OPTIONS = { allowInsecureLocalhost: true };

describe('parseAgentRecord (CHECK 4)', () => {
  it('builds a validated DiscoveredAgent from raw ENS text records', () => {
    const agent = parseAgentRecord('invoice-agent.test.eth', makeRawRecords(), ENDPOINT_OPTIONS);
    expect(agent.id).toBe('invoice-specialist');
    expect(agent.displayName).toBe('Invoice Assistant');
    expect(agent.capabilities).toEqual(['invoices', 'billing', 'overdue']);
    expect(agent.endpointUrl.protocol).toBe('https:');
    expect(agent.version).toBe('1.0.0');
  });

  it('rejects records with a missing agent.id', () => {
    expect(() =>
      parseAgentRecord('invoice-agent.test.eth', makeRawRecords({ id: null }), ENDPOINT_OPTIONS),
    ).toThrow(AgentRecordValidationError);
  });

  it('rejects records with a malformed agent.id', () => {
    expect(() =>
      parseAgentRecord(
        'invoice-agent.test.eth',
        makeRawRecords({ id: 'Not A Valid Id!' }),
        ENDPOINT_OPTIONS,
      ),
    ).toThrow(AgentRecordValidationError);
  });

  it('rejects records with malformed capabilities', () => {
    expect(() =>
      parseAgentRecord(
        'invoice-agent.test.eth',
        makeRawRecords({ capabilities: 'invoices, has spaces, overdue' }),
        ENDPOINT_OPTIONS,
      ),
    ).toThrow(AgentRecordValidationError);
  });

  it('rejects records with malformed version', () => {
    expect(() =>
      parseAgentRecord('invoice-agent.test.eth', makeRawRecords({ version: 'v1' }), ENDPOINT_OPTIONS),
    ).toThrow(AgentRecordValidationError);
  });

  it('rejects records with a missing endpoint', () => {
    expect(() =>
      parseAgentRecord('invoice-agent.test.eth', makeRawRecords({ endpoint: null }), ENDPOINT_OPTIONS),
    ).toThrow(AgentRecordValidationError);
  });

  it('rejects records with an invalid or non-HTTPS endpoint', () => {
    expect(() =>
      parseAgentRecord(
        'invoice-agent.test.eth',
        makeRawRecords({ endpoint: 'not-a-url' }),
        ENDPOINT_OPTIONS,
      ),
    ).toThrow(InvalidAgentEndpointError);

    expect(() =>
      parseAgentRecord(
        'invoice-agent.test.eth',
        makeRawRecords({ endpoint: 'http://invoice-agent.example.com' }),
        ENDPOINT_OPTIONS,
      ),
    ).toThrow(InvalidAgentEndpointError);

    expect(() =>
      parseAgentRecord(
        'invoice-agent.test.eth',
        makeRawRecords({ endpoint: 'javascript:alert(1)' }),
        ENDPOINT_OPTIONS,
      ),
    ).toThrow(InvalidAgentEndpointError);
  });
});

describe('discoverAgents (CHECK 4)', () => {
  it('discovers all valid agents from the directory', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory(['invoice-agent.test.eth', 'brand-agent.test.eth']);
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());
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

    const logger = new FakeLogger();
    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
      logger,
    });

    expect(result.agents.map((agent) => agent.id)).toEqual([
      'invoice-specialist',
      'brand-specialist',
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('skips a malformed agent and keeps the valid ones discoverable', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory([
      'malformed-agent.test.eth',
      'invoice-agent.test.eth',
      'brand-agent.test.eth',
    ]);
    // Malformed: missing agent.id AND invalid endpoint.
    gateway.setAgentRecords(
      'malformed-agent.test.eth',
      makeRawRecords({ id: null, endpoint: 'http://malformed.example.com' }),
    );
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());
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

    const logger = new FakeLogger();
    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
      logger,
    });

    // One malformed agent MUST NOT abort discovery.
    expect(result.agents.map((agent) => agent.id)).toEqual([
      'invoice-specialist',
      'brand-specialist',
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.ensName).toBe('malformed-agent.test.eth');
    expect(logger.warnings.some((warning) => warning.scope === 'discovery')).toBe(true);
  });

  it('skips an agent whose ENS name cannot be resolved, without aborting discovery', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory(['ghost-agent.test.eth', 'invoice-agent.test.eth']);
    gateway.setUnresolved('ghost-agent.test.eth');
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());

    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(['invoice-specialist']);
    expect(result.skipped).toHaveLength(1);
  });

  it('skips duplicate agent ids (first discovery wins)', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory(['invoice-agent.test.eth', 'twin-agent.test.eth']);
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());
    gateway.setAgentRecords(
      'twin-agent.test.eth',
      makeRawRecords({ endpoint: 'https://twin-agent.test.example' }),
    );

    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.ensName).toBe('invoice-agent.test.eth');
    expect(result.skipped).toHaveLength(1);
  });

  it('skips invalid ENS names listed in the directory record', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectoryRaw(
      JSON.stringify({ version: 1, agents: ['not a valid name', 'invoice-agent.test.eth'] }),
    );
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());

    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(['invoice-specialist']);
    expect(result.skipped).toHaveLength(0);
  });

  it('returns zero agents when the directory is empty (router must degrade clearly)', async () => {
    const gateway = new FakeEnsGateway();
    gateway.setDirectory([]);

    const result = await discoverAgents(gateway, TEST_DIRECTORY_NAME, {
      allowInsecureLocalhost: true,
    });

    expect(result.agents).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('serves discovery from the TTL cache when enabled', async () => {
    clearDiscoveryCache();
    const gateway = new FakeEnsGateway();
    gateway.setDirectory(['invoice-agent.test.eth']);
    gateway.setAgentRecords('invoice-agent.test.eth', makeRawRecords());

    const options = { allowInsecureLocalhost: true, cacheTtlMs: 60_000 };
    await discoverAgents(gateway, TEST_DIRECTORY_NAME, options);
    const callsAfterFirst = gateway.calls.length;
    await discoverAgents(gateway, TEST_DIRECTORY_NAME, options);

    // No new ENS reads while the cache is fresh.
    expect(gateway.calls.length).toBe(callsAfterFirst);
    clearDiscoveryCache();
  });
});
