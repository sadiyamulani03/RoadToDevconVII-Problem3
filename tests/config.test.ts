/**
 * Router configuration — CHECK 6 SSRF hardening.
 *
 * The plain-http loopback exception is a development/testing convenience only.
 * In production it must be forced OFF so an ENS record can never be used to
 * reach internal services over http.
 */
import { describe, expect, it } from 'vitest';

import { loadRouterConfig } from '../src/config.js';

const BASE_ENV = {
  ENS_DIRECTORY_NAME: 'agent-directory.test.eth',
  SEPOLIA_RPC_URL: 'https://rpc.test.example',
};

describe('loadRouterConfig (CHECK 6 SSRF hardening)', () => {
  it('allows the localhost exception in development by default', () => {
    const config = loadRouterConfig({ ...BASE_ENV, NODE_ENV: 'development' });
    expect(config.allowLocalhostEndpoints).toBe(true);
  });

  it('forces the localhost exception OFF in production, even when ALLOW_LOCALHOST_ENDPOINTS=true', () => {
    const config = loadRouterConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      ALLOW_LOCALHOST_ENDPOINTS: 'true',
    });
    expect(config.allowLocalhostEndpoints).toBe(false);
  });

  it('honours ALLOW_LOCALHOST_ENDPOINTS=false in development', () => {
    const config = loadRouterConfig({
      ...BASE_ENV,
      NODE_ENV: 'development',
      ALLOW_LOCALHOST_ENDPOINTS: 'false',
    });
    expect(config.allowLocalhostEndpoints).toBe(false);
  });

  it('rejects invalid ALLOW_LOCALHOST_ENDPOINTS values', () => {
    expect(() =>
      loadRouterConfig({ ...BASE_ENV, ALLOW_LOCALHOST_ENDPOINTS: 'maybe' }),
    ).toThrow();
  });

  it('requires ENS_DIRECTORY_NAME and SEPOLIA_RPC_URL', () => {
    expect(() => loadRouterConfig({})).toThrow(/ENS_DIRECTORY_NAME/);
    expect(() => loadRouterConfig({ ENS_DIRECTORY_NAME: 'x.test.eth' })).toThrow(
      /SEPOLIA_RPC_URL/,
    );
  });
});
