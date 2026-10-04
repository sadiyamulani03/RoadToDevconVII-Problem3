/**
 * CHECK 9 — zero real credentials in tracked files.
 * Runs the real secret scanner over all trackable files and verifies the
 * .gitignore / .env.example guardrails.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isPlaceholderValue } from '../../src/security/secrets.js';
import { scanForSecrets } from '../../scripts/secret-scan.js';

describe('repository security (CHECK 9)', () => {
  it('contains no credential-shaped patterns in any trackable file', () => {
    const result = scanForSecrets(process.cwd());
    const details = result.findings
      .map((finding) => `${finding.file}:${finding.line} (${finding.pattern})`)
      .join('\n');
    expect(details, `secret scan found:\n${details}`).toEqual('');
    expect(result.filesScanned).toBeGreaterThan(10);
  });

  it('ignores .env and secret artifacts via .gitignore', () => {
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/\.env\.local/m);
    expect(gitignore).toMatch(/\*\.pem/m);
    expect(gitignore).toMatch(/\*\.key/m);
    expect(gitignore).toMatch(/node_modules/m);
    expect(gitignore).toMatch(/dist\//m);
  });

  it('provides .env.example with placeholders only', () => {
    expect(existsSync(join(process.cwd(), '.env.example'))).toBe(true);
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

    // Required keys exist.
    for (const key of ['LLM_API_KEY', 'DEPLOYER_PRIVATE_KEY', 'SEPOLIA_RPC_URL', 'ENS_DIRECTORY_NAME']) {
      expect(envExample, `.env.example must contain ${key}`).toMatch(new RegExp(`^${key}=`, 'm'));
    }

    // Secret-shaped keys carry placeholder values, never real ones.
    const lines = envExample.split('\n');
    for (const line of lines) {
      const match = line.match(/^(LLM_API_KEY|DEPLOYER_PRIVATE_KEY)=(.*)$/);
      if (match !== null) {
        const value = match[2]?.trim() ?? '';
        expect(isPlaceholderValue(value), `${match[1]} must be a placeholder`).toBe(true);
        expect(value).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/);
        expect(value).not.toMatch(/\b0x[0-9a-fA-F]{64}\b/);
      }
    }
  });

  it('never places agent endpoint URLs in environment configuration', () => {
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    // .env.example documents infrastructure config only (LLM_BASE_URL is a
    // public API base URL, not an agent endpoint).
    expect(envExample).not.toMatch(/^.*AGENT_URL=/m);
    expect(envExample).not.toMatch(/^.*AGENT_ENDPOINT=/m);
    expect(envExample).not.toMatch(/^.*SPECIALIST_URL=/m);
  });
});
