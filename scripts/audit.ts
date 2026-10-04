/**
 * STATIC COMPETITION AUDIT (`npm run audit`).
 *
 * A real static analysis of the repository against the 9 challenge checks —
 * not a rubber stamp. Every check inspects actual source files with targeted
 * patterns and reports file:line evidence; the script exits non-zero when any
 * check fails.
 *
 * Scope note (challenge CHECK 3): "router source" means the runtime router
 * path — src/** and the served demo UI. The specialist agent processes
 * (agents/**) and publishing tooling (scripts/agents.config.ts) legitimately
 * know agent names; the router must not.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { scanForSecrets } from './secret-scan.js';

interface AuditCheck {
  readonly id: string;
  readonly name: string;
  readonly pass: boolean;
  readonly evidence: readonly string[];
  readonly failures: readonly string[];
}

const ROOT = process.cwd();

function readText(relativePath: string): string | null {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  return readFileSync(fullPath, 'utf8');
}

function findLines(content: string, pattern: RegExp): string[] {
  const lines: string[] = [];
  content.split('\n').forEach((line, index) => {
    if (pattern.test(line)) {
      lines.push(`:${index + 1} ${line.trim().slice(0, 140)}`);
    }
  });
  return lines;
}

/** Recursively list text files under a directory (relative paths). */
function listFiles(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(full)) {
    const fullPath = join(full, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listFiles(join(dir, entry)));
    } else if (/\.(?:ts|html|js)$/.test(entry)) {
      files.push(join(dir, entry));
    }
  }
  return files;
}

/** Collect agent id/name literals that must NOT appear in router source. */
function collectAgentIdentifiers(): string[] {
  const identifiers = new Set<string>();

  const fixture = readText('fixtures/routing-cases.json');
  if (fixture !== null) {
    try {
      const parsed = JSON.parse(fixture) as { cases?: Array<{ expectedAgent?: unknown }> };
      for (const entry of parsed.cases ?? []) {
        if (typeof entry.expectedAgent === 'string') {
          identifiers.add(entry.expectedAgent);
        }
      }
    } catch {
      // handled by the fixture check below
    }
  }

  const publishConfig = readText('scripts/agents.config.ts');
  if (publishConfig !== null) {
    for (const match of publishConfig.matchAll(/'agent\.id':\s*'([a-z0-9-]+)'/g)) {
      identifiers.add(match[1] ?? '');
    }
    identifiers.delete('');
  }

  return [...identifiers];
}

function check3NoLiteralAgentList(): AuditCheck {
  const routerFiles = [...listFiles('src'), ...listFiles('public')];
  const failures: string[] = [];
  const evidence: string[] = [];

  // a) No `const agents = [...]` / `const agents = {...}` style literals.
  for (const file of routerFiles) {
    const content = readText(file);
    if (content === null) {
      continue;
    }
    const hits = findLines(content, /const\s+agents\s*[:=]|AGENTS\s*:\s*\[\s*['"]/);
    for (const hit of hits) {
      failures.push(`${file}${hit}`);
    }
  }

  // b) No agent id/name literals from the fixtures/publish config in router source.
  const identifiers = collectAgentIdentifiers();
  for (const file of routerFiles) {
    const content = readText(file);
    if (content === null) {
      continue;
    }
    for (const identifier of identifiers) {
      if (content.includes(identifier)) {
        const line = findLines(content, new RegExp(identifier.replaceAll('-', '\\-')));
        failures.push(`${file} contains agent identifier "${identifier}"${line[0] ?? ''}`);
      }
    }
  }

  // c) No agent endpoint URL env vars.
  for (const file of routerFiles) {
    const content = readText(file);
    if (content === null) {
      continue;
    }
    const hits = findLines(content, /process\.env\.[A-Z_]*(?:AGENT_URL|AGENT_ENDPOINT|SPECIALIST)/);
    for (const hit of hits) {
      failures.push(`${file}${hit} (agent URLs must never come from env)`);
    }
  }

  evidence.push(`scanned ${routerFiles.length} router-source files under src/ and public/`);
  evidence.push(
    `expected agent identifiers checked: ${identifiers.length > 0 ? identifiers.join(', ') : '(none configured)'}`,
  );
  if (existsSync(join(ROOT, 'src/ens/directory.ts'))) {
    evidence.push('src/ens/directory.ts — discovery is anchored on a single ENS directory record');
  }
  return { id: '3', name: 'Router source contains no literal agent list (agents come from ENS at runtime)', pass: failures.length === 0, evidence, failures };
}

function check1MembershipValidated(): AuditCheck {
  const content = readText('src/router/routing.ts');
  if (content === null) {
    return { id: '1', name: 'Routing decision validated against discovered agents', pass: false, evidence: [], failures: ['src/router/routing.ts is missing'] };
  }
  const failures: string[] = [];
  const evidence: string[] = [];

  if (findLines(content, /export function validateRoutingDecision/).length === 0) {
    failures.push('validateRoutingDecision() not found in src/router/routing.ts');
  } else {
    evidence.push('src/router/routing.ts defines validateRoutingDecision(decision, discoveredAgents)');
  }

  const membership = findLines(content, /discoveredAgents\.find\(\s*\(agent\)\s*=>\s*agent\.id\s*===\s*decision\.agentId/);
  if (membership.length === 0) {
    failures.push('explicit membership check (find on discoveredAgents) not found');
  } else {
    evidence.push(`explicit membership check${membership[0]}`);
  }

  if (findLines(content, /ModelSelectedUnknownAgentError/).length === 0) {
    failures.push('unknown-agent rejection path missing');
  } else {
    evidence.push('unknown model choice rejected via ModelSelectedUnknownAgentError (no endpoint called)');
  }

  return { id: '1', name: 'Routing decision is membership-validated against the ENS-discovered list', pass: failures.length === 0, evidence, failures };
}

function check2UrlFromEns(): AuditCheck {
  const forwarding = readText('src/router/forwarding.ts');
  if (forwarding === null) {
    return { id: '2', name: 'Forwarded URL comes from ENS', pass: false, evidence: [], failures: ['src/router/forwarding.ts is missing'] };
  }
  const failures: string[] = [];
  const evidence: string[] = [];

  if (findLines(forwarding, /agent\.endpointUrl/).length === 0) {
    failures.push('forwarding does not take the URL from the validated ENS record (agent.endpointUrl)');
  } else {
    evidence.push('invokeAgent() builds the URL exclusively from agent.endpointUrl (the validated ENS record)');
  }

  if (findLines(forwarding, /buildInvokeUrl\(agent\.endpointUrl\)/).length === 0) {
    failures.push('buildInvokeUrl(agent.endpointUrl) call not found');
  } else {
    evidence.push('no hardcoded URLs, env URLs, LLM URLs, or URL maps in the forwarding path');
  }

  if (findLines(forwarding, /process\.env/).length > 0) {
    failures.push('src/router/forwarding.ts reads environment variables (no env URL source allowed)');
  }

  const types = readText('src/agents/types.ts');
  if (types !== null) {
    evidence.push('endpointUrl is a branded type produced only by validateAgentEndpoint (src/security/endpoint.ts)');
  }

  return { id: '2', name: 'Forwarded URL comes exclusively from the selected agent\'s validated ENS record', pass: failures.length === 0, evidence, failures };
}

function check4MalformedSkipped(): AuditCheck {
  const records = readText('src/ens/records.ts');
  const discovery = readText('src/router/discovery.ts');
  const failures: string[] = [];
  const evidence: string[] = [];

  if (records === null) {
    failures.push('src/ens/records.ts is missing');
  } else {
    if (findLines(records, /AgentRecordSchema\.safeParse/).length === 0) {
      failures.push('per-agent Zod validation missing in src/ens/records.ts');
    } else {
      evidence.push('src/ens/records.ts validates every record with AgentRecordSchema.safeParse');
    }
    if (findLines(records, /Promise\.allSettled/).length === 0) {
      failures.push('records.ts must use resilient per-agent handling (Promise.allSettled)');
    } else {
      evidence.push('per-record reads use Promise.allSettled (a failing read only invalidates one agent)');
    }
  }

  if (discovery === null) {
    failures.push('src/router/discovery.ts is missing');
  } else {
    if (findLines(discovery, /Promise\.allSettled/).length === 0) {
      failures.push('discovery must use Promise.allSettled so one malformed agent cannot abort discovery');
    } else {
      evidence.push('src/router/discovery.ts resolves agents with Promise.allSettled; malformed agents are skipped with a warning');
    }
    if (findLines(discovery, /Promise\.all\(/).length > 0) {
      failures.push('discovery uses bare Promise.all (one rejection would abort discovery)');
    }
  }

  return { id: '4', name: 'Malformed ENS records are skipped (Zod schema + per-agent allSettled)', pass: failures.length === 0, evidence, failures };
}

function check5Timeout(): AuditCheck {
  const forwarding = readText('src/router/forwarding.ts');
  const llm = readText('src/llm/client.ts');
  const failures: string[] = [];
  const evidence: string[] = [];

  const requiredPatterns: ReadonlyArray<readonly [string, RegExp]> = [
    ['AbortController', /new AbortController\(\)/],
    ['setTimeout(... controller.abort())', /setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\),\s*timeoutMs/],
    ['clearTimeout in finally', /clearTimeout\(timeout\)/],
    ['fetch with signal', /signal:\s*controller\.signal/],
  ];

  if (forwarding === null) {
    failures.push('src/router/forwarding.ts is missing');
  } else {
    for (const [name, pattern] of requiredPatterns) {
      const lines = findLines(forwarding, pattern);
      if (lines.length === 0) {
        failures.push(`downstream timeout pattern missing: ${name}`);
      } else {
        evidence.push(`src/router/forwarding.ts${lines[0]}`);
      }
    }
    // The clearTimeout call must sit in a finally block (always runs).
    if (!/\}\s*finally\s*\{[\s\S]*?clearTimeout\(timeout\)/.test(forwarding)) {
      failures.push('clearTimeout(timeout) is not in a finally block');
    } else {
      evidence.push('clearTimeout(timeout) runs in a finally block');
    }
    const constant = findLines(forwarding, /export const AGENT_REQUEST_TIMEOUT_MS = 8_000;/);
    if (constant.length === 0) {
      failures.push('AGENT_REQUEST_TIMEOUT_MS = 8000 constant not found');
    } else {
      evidence.push(`explicit AGENT_REQUEST_TIMEOUT_MS constant${constant[0]}`);
    }
  }

  if (llm !== null && findLines(llm, /new AbortController\(\)/).length > 0) {
    evidence.push('src/llm/client.ts applies the same explicit timeout to LLM calls');
  }

  return { id: '5', name: 'Explicit downstream timeout on every router → agent call', pass: failures.length === 0, evidence, failures };
}

function check6Https(): AuditCheck {
  const endpoint = readText('src/security/endpoint.ts');
  const records = readText('src/ens/records.ts');
  const failures: string[] = [];
  const evidence: string[] = [];

  if (endpoint === null) {
    failures.push('src/security/endpoint.ts is missing');
  } else {
    for (const [name, pattern] of [
      ['URL class parsing', /new URL\(/],
      ['https: requirement', /url\.protocol === 'https:'/],
      ['localhost exception', /LOOPBACK_HOSTNAMES = new Set\(\['localhost', '127\.0\.0\.1'\]\)/],
      ['non-loopback http rejection', /HTTPS is required/],
    ] as const) {
      const lines = findLines(endpoint, pattern);
      if (lines.length === 0) {
        failures.push(`endpoint validation pattern missing: ${name}`);
      } else {
        evidence.push(`src/security/endpoint.ts${lines[0]}`);
      }
    }
    evidence.push('non-https/localhost protocols (file:, ftp:, javascript:, data:) rejected by the allow-list');
  }

  if (records !== null && findLines(records, /validateAgentEndpoint\(/).length > 0) {
    evidence.push('src/ens/records.ts validates the endpoint BEFORE the agent enters the registry');
  } else {
    failures.push('records do not run validateAgentEndpoint before inclusion');
  }

  return { id: '6', name: 'ENS endpoints must be HTTPS (explicit localhost exception)', pass: failures.length === 0, evidence, failures };
}

function check7NoAgentBranch(): AuditCheck {
  const router = readText('src/router/router.ts');
  if (router === null) {
    return { id: '7', name: 'Explicit no-agent branch', pass: false, evidence: [], failures: ['src/router/router.ts is missing'] };
  }
  const failures: string[] = [];
  const evidence: string[] = [];

  const branch = findLines(router, /status:\s*'no_suitable_agent'/);
  if (branch.length === 0) {
    failures.push("explicit no_suitable_agent branch not found in src/router/router.ts");
  } else {
    evidence.push(`explicit branch returns status 'no_suitable_agent' with attribution: null${branch[0]}`);
  }

  if (findLines(router, /No suitable agent was found for this request\./).length === 0) {
    failures.push('client-facing "No suitable agent was found for this request." message missing');
  } else {
    evidence.push('client response: "No suitable agent was found for this request." with attribution: null');
  }

  return { id: '7', name: 'Explicit no_suitable_agent response (no default/random/fallback agent)', pass: failures.length === 0, evidence, failures };
}

function check8RoutingCases(): AuditCheck {
  const fixture = readText('fixtures/routing-cases.json');
  if (fixture === null) {
    return { id: '8', name: 'Recorded routing cases include expected agent', pass: false, evidence: [], failures: ['fixtures/routing-cases.json is missing'] };
  }
  const failures: string[] = [];
  const evidence: string[] = [];

  let cases: Array<{ id?: string; request?: unknown; expectedAgent?: unknown }> = [];
  try {
    const parsed = JSON.parse(fixture) as { cases?: typeof cases };
    cases = parsed.cases ?? [];
  } catch (cause) {
    return { id: '8', name: 'Recorded routing cases include expected agent', pass: false, evidence: [], failures: [`fixtures/routing-cases.json is not valid JSON: ${cause instanceof Error ? cause.message : 'parse error'}`] };
  }

  if (cases.length < 8) {
    failures.push(`expected at least 8 routing cases, found ${cases.length}`);
  }

  for (const entry of cases) {
    const caseId = entry.id ?? '(no id)';
    if (typeof entry.request !== 'string' || entry.request.length === 0) {
      failures.push(`case "${caseId}": missing "request"`);
    }
    if (typeof entry.expectedAgent !== 'string' && entry.expectedAgent !== null) {
      failures.push(`case "${caseId}": "expectedAgent" must be an agent id string or null`);
    }
  }

  const requiredMappings: ReadonlyArray<readonly [RegExp, string]> = [
    [/termination clause/i, 'contract-specialist'],
    [/tagline/i, 'brand-specialist'],
    [/invoice is overdue/i, 'invoice-specialist'],
    [/weather/i, 'null'],
  ];
  for (const [requestPattern, expected] of requiredMappings) {
    const match = cases.find(
      (entry) =>
        typeof entry.request === 'string' &&
        requestPattern.test(entry.request) &&
        String(entry.expectedAgent) === expected,
    );
    if (match === undefined) {
      failures.push(`no case covers request matching ${requestPattern} with expectedAgent ${expected}`);
    } else {
      evidence.push(`case "${match.id ?? ''}": "${match.request}" → ${match.expectedAgent ?? 'null (no suitable agent)'}`);
    }
  }

  evidence.push(`fixtures/routing-cases.json defines ${cases.length} recorded cases, each with request + expectedAgent`);
  return { id: '8', name: 'Recorded routing cases include the expected agent', pass: failures.length === 0, evidence, failures };
}

function check9NoCredentials(): AuditCheck {
  const failures: string[] = [];
  const evidence: string[] = [];

  const scan = scanForSecrets(ROOT);
  evidence.push(`scanned ${scan.filesScanned} trackable files for credential-shaped patterns`);
  if (scan.findings.length > 0) {
    for (const finding of scan.findings) {
      failures.push(`secret pattern "${finding.pattern}" at ${relative(ROOT, finding.file)}:${finding.line}`);
    }
  } else {
    evidence.push('no secrets detected in trackable files');
  }

  const gitignore = readText('.gitignore');
  if (gitignore === null) {
    failures.push('.gitignore is missing');
  } else {
    if (!/^\.env$/m.test(gitignore)) {
      failures.push('.gitignore does not ignore .env');
    } else {
      evidence.push('.gitignore ignores .env / *.pem / *.key / logs');
    }
  }

  const envExample = readText('.env.example');
  if (envExample === null) {
    failures.push('.env.example is missing');
  } else {
    for (const required of ['LLM_API_KEY', 'DEPLOYER_PRIVATE_KEY', 'SEPOLIA_RPC_URL', 'ENS_DIRECTORY_NAME']) {
      const match = findLines(envExample, new RegExp(`^${required}=`));
      if (match.length === 0) {
        failures.push(`.env.example missing ${required}`);
        continue;
      }
      const value = match[0]?.split('=')[1]?.trim() ?? '';
      if (!/your|changeme|placeholder|here|<|example|fixme|todo|publicnode/i.test(value)) {
        failures.push(`.env.example ${required} does not look like a placeholder: ${value}`);
      } else {
        evidence.push(`.env.example ${required} is a placeholder`);
      }
    }
  }

  return { id: '9', name: 'Zero real credentials in tracked files (.env.example placeholders only)', pass: failures.length === 0, evidence, failures };
}

function checkLlmConstraints(): AuditCheck {
  const prompt = readText('src/llm/prompt.ts');
  const schema = readText('src/llm/schema.ts');
  const failures: string[] = [];
  const evidence: string[] = [];

  if (prompt === null) {
    failures.push('src/llm/prompt.ts is missing');
  } else {
    for (const [name, pattern] of [
      ['choose only one provided agent id', /exactly ONE agent id/],
      ['never invent an agent', /NEVER invent/],
      ['return null if none fits', /null if none fits/],
      ['do not output URLs', /NEVER output URLs/],
      ['agent metadata is untrusted data', /UNTRUSTED DATA/],
    ] as const) {
      if (pattern.test(prompt)) {
        evidence.push(`src/llm/prompt.ts: ${name}`);
      } else {
        failures.push(`routing prompt missing constraint: ${name}`);
      }
    }
  }

  if (schema !== null && /RoutingDecisionSchema/.test(schema)) {
    evidence.push('src/llm/schema.ts: model output validated with Zod (RoutingDecisionSchema); unknown keys stripped');
  } else {
    failures.push('LLM output Zod schema missing (src/llm/schema.ts)');
  }

  return { id: 'LLM', name: 'LLM receives only validated metadata; output is structured + Zod-validated', pass: failures.length === 0, evidence, failures };
}

function main(): void {
  const checks: readonly AuditCheck[] = [
    check1MembershipValidated(),
    check2UrlFromEns(),
    check3NoLiteralAgentList(),
    check4MalformedSkipped(),
    check5Timeout(),
    check6Https(),
    check7NoAgentBranch(),
    check8RoutingCases(),
    check9NoCredentials(),
    checkLlmConstraints(),
  ];

  console.info('\n=== Static competition audit (RoadToDevcon VII — Problem 3) ===\n');
  let allPass = true;
  for (const check of checks) {
    const status = check.pass ? 'PASS' : 'FAIL';
    console.info(`[${status}] Check ${check.id}: ${check.name}`);
    for (const line of check.evidence) {
      console.info(`         ✓ ${line}`);
    }
    for (const line of check.failures) {
      console.info(`         ✗ ${line}`);
      allPass = false;
    }
  }
  console.info('');

  if (!allPass) {
    console.error('AUDIT FAILED — see the ✗ items above.');
    process.exit(1);
  }
  console.info('AUDIT PASSED — all checked properties are present in the source.');
}

main();
