/**
 * CHECK 6 — ENS endpoint must be HTTPS (explicit localhost exception).
 * Unit tests for validateAgentEndpoint, the single endpoint-safety authority.
 */
import { describe, expect, it } from 'vitest';

import {
  InvalidAgentEndpointError,
  validateAgentEndpoint,
} from '../../src/security/endpoint.js';

const OPTIONS = { allowInsecureLocalhost: true };

describe('validateAgentEndpoint (CHECK 6)', () => {
  it('accepts HTTPS endpoints', () => {
    const url = validateAgentEndpoint('https://invoice-agent.example.com', OPTIONS);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('invoice-agent.example.com');
  });

  it('accepts http://localhost with the explicit development exception', () => {
    const url = validateAgentEndpoint('http://localhost:8791', OPTIONS);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('8791');
  });

  it('accepts http://127.0.0.1 with the explicit development exception', () => {
    const url = validateAgentEndpoint('http://127.0.0.1:8793', OPTIONS);
    expect(url.hostname).toBe('127.0.0.1');
  });

  it('rejects plain http:// on non-loopback hosts even when the exception is enabled', () => {
    expect(() =>
      validateAgentEndpoint('http://invoice-agent.example.com', OPTIONS),
    ).toThrow(InvalidAgentEndpointError);
  });

  it('rejects http://localhost when the development exception is disabled', () => {
    expect(() =>
      validateAgentEndpoint('http://localhost:8791', { allowInsecureLocalhost: false }),
    ).toThrow(InvalidAgentEndpointError);
  });

  it('rejects non-https protocols (file:, ftp:, javascript:, data:, gopher:)', () => {
    for (const raw of [
      'file:///etc/passwd',
      'ftp://invoice-agent.example.com',
      'javascript:alert(1)',
      'data:text/plain,hello',
      'gopher://invoice-agent.example.com',
    ]) {
      expect(() => validateAgentEndpoint(raw, OPTIONS)).toThrow(InvalidAgentEndpointError);
    }
  });

  it('rejects malformed URL values', () => {
    for (const raw of ['not-a-url', '', '   ', 'https://', 'http://']) {
      expect(() => validateAgentEndpoint(raw, OPTIONS)).toThrow(InvalidAgentEndpointError);
    }
  });

  it('rejects URLs with embedded credentials (no authenticated URLs)', () => {
    expect(() =>
      validateAgentEndpoint('https://user:pass@invoice-agent.example.com', OPTIONS),
    ).toThrow(InvalidAgentEndpointError);
    expect(() =>
      validateAgentEndpoint('http://localhost:8791@evil.example', OPTIONS),
    ).toThrow(InvalidAgentEndpointError);
  });

  it('trims surrounding whitespace before validating', () => {
    const url = validateAgentEndpoint('  https://invoice-agent.example.com  ', OPTIONS);
    expect(url.hostname).toBe('invoice-agent.example.com');
  });
});
