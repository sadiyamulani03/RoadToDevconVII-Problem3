/**
 * CHECK 8 — recorded routing cases must include the expected agent.
 * Validates fixtures/routing-cases.json structure and coverage.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isValidEnsName } from '../src/ens/names.js';

interface RoutingCase {
  id?: string;
  request?: unknown;
  expectedAgent?: unknown;
}

const KNOWN_SPECIALIST_IDS = ['contract-specialist', 'brand-specialist', 'invoice-specialist'];

function loadCases(): RoutingCase[] {
  const raw = readFileSync(join(process.cwd(), 'fixtures/routing-cases.json'), 'utf8');
  const parsed = JSON.parse(raw) as { cases?: RoutingCase[] };
  return parsed.cases ?? [];
}

describe('fixtures/routing-cases.json (CHECK 8)', () => {
  it('exists and contains cases', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  it('specifies id, request, and expectedAgent for EVERY case', () => {
    for (const entry of loadCases()) {
      expect(entry.id, 'every case has an id').toBeTruthy();
      expect(typeof entry.request, 'every case has a request string').toBe('string');
      expect((entry.request as string).length, 'request is non-empty').toBeGreaterThan(0);
      expect(
        typeof entry.expectedAgent === 'string' || entry.expectedAgent === null,
        `case "${entry.id}": expectedAgent must be an agent id or null`,
      ).toBe(true);
    }
  });

  it('references only known specialist ids (or null)', () => {
    for (const entry of loadCases()) {
      if (typeof entry.expectedAgent === 'string') {
        expect(KNOWN_SPECIALIST_IDS).toContain(entry.expectedAgent);
      }
    }
  });

  it('covers the four required routing mappings', () => {
    const cases = loadCases();

    // 1. contract question → contract specialist
    expect(
      cases.some(
        (entry) =>
          typeof entry.request === 'string' &&
          /termination clause/i.test(entry.request) &&
          entry.expectedAgent === 'contract-specialist',
      ),
    ).toBe(true);

    // 2. brand-copy request → brand specialist
    expect(
      cases.some(
        (entry) =>
          typeof entry.request === 'string' &&
          /tagline/i.test(entry.request) &&
          entry.expectedAgent === 'brand-specialist',
      ),
    ).toBe(true);

    // 3. invoice question → invoice specialist
    expect(
      cases.some(
        (entry) =>
          typeof entry.request === 'string' &&
          /invoice is overdue/i.test(entry.request) &&
          entry.expectedAgent === 'invoice-specialist',
      ),
    ).toBe(true);

    // 4. unmatched request → null (no suitable agent)
    expect(
      cases.some(
        (entry) =>
          typeof entry.request === 'string' &&
          /weather/i.test(entry.request) &&
          entry.expectedAgent === null,
      ),
    ).toBe(true);
  });

  it('includes at least one null (no suitable agent) case', () => {
    const cases = loadCases();
    expect(cases.filter((entry) => entry.expectedAgent === null).length).toBeGreaterThanOrEqual(1);
  });

  it('uses valid ENS-name-shaped agent identifiers', () => {
    for (const entry of loadCases()) {
      if (typeof entry.expectedAgent === 'string') {
        // agent ids are lowercase slugs (single label of the ENS name)
        expect(entry.expectedAgent).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
        expect(isValidEnsName(`${entry.expectedAgent}.example.eth`)).toBe(true);
      }
    }
  });
});
