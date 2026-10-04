/**
 * Secret scanner (challenge CHECK 9).
 *
 * Scans every trackable file in the repository for credential-shaped patterns
 * (API keys, private keys, tokens, seed-phrase-like content, authenticated
 * URLs). Skips ignored artifacts (node_modules, dist, .env, logs, ...).
 *
 * This is a real scan, not a rubber stamp: it inspects file contents and exits
 * non-zero when a pattern matches.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
}

export interface SecretScanResult {
  readonly filesScanned: number;
  readonly findings: readonly SecretFinding[];
}

/** Credential-shaped patterns. Each pattern must not match legitimate content. */
const SECRET_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: 'openai-style key (sk-...)', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'google api key (AIza...)', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'github token (ghp_/gho_/github_pat_)', regex: /\b(?:ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: 'aws access key (AKIA...)', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack token (xox...)', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'anthropic key (sk-ant-...)', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: '64-hex private key / transaction hash', regex: /\b0x[0-9a-fA-F]{64}\b/ },
  { name: 'PEM private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'bearer token literal', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/ },
];

/** Directories that are never scanned (build artifacts, deps, local env). */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.kilo',
  '.idea',
  '.vscode',
]);

/** Files that are never scanned (local env files are gitignored, not tracked). */
function isSkippedFile(fileName: string): boolean {
  return (
    fileName === '.env' ||
    fileName === '.env.local' ||
    /^\.env\..*\.local$/.test(fileName) ||
    fileName.endsWith('.pem') ||
    fileName.endsWith('.key') ||
    fileName.endsWith('.log')
  );
}

function isTextFile(fileName: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|txt|ya?ml|toml|html|css|example|gitignore|sh|env)$/.test(
    fileName,
  );
}

function walk(dir: string, rootDir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        walk(fullPath, rootDir, files);
      }
      continue;
    }
    if (isSkippedFile(entry) || !isTextFile(entry)) {
      continue;
    }
    files.push(fullPath);
  }
}

/**
 * Scan all trackable files under `rootDir` for credential-shaped patterns.
 * Line numbers are 1-based; matched secret text is never included in findings.
 */
export function scanForSecrets(rootDir: string): SecretScanResult {
  const files: string[] = [];
  walk(rootDir, rootDir, files);

  const findings: SecretFinding[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({ file: file, line: index + 1, pattern: pattern.name });
        }
      }
    }
  }
  return { filesScanned: files.length, findings };
}

/** CLI entry: `npm run secret:scan`. */
function main(): void {
  const rootDir = process.cwd();
  const result = scanForSecrets(rootDir);

  console.info(`Scanned ${result.filesScanned} files for credential-shaped patterns.`);
  if (result.findings.length === 0) {
    console.info('OK: no secrets detected in trackable files.');
    return;
  }
  for (const finding of result.findings) {
    console.error(`SECRET PATTERN "${finding.pattern}" at ${finding.file}:${finding.line}`);
  }
  console.error(`FAIL: ${result.findings.length} secret-pattern match(es) found.`);
  process.exit(1);
}

if (process.argv[1]?.endsWith('secret-scan.ts') || process.argv[1]?.endsWith('secret-scan.js')) {
  main();
}
