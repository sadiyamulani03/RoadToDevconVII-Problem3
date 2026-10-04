/**
 * Router configuration.
 *
 * SECURITY (challenge CHECK 2 + CHECK 9): environment variables may contain
 * infrastructure configuration only — the LLM API key, the RPC endpoint, ports,
 * timeouts. They must NEVER contain agent endpoint URLs: those come
 * exclusively from validated ENS records at runtime.
 */
import { readOptionalEnv } from './security/secrets.js';

export interface EnsConfig {
  /** The ONLY ENS identity the router is configured with (the discovery root). */
  readonly directoryName: string;
  /** Sepolia JSON-RPC endpoint (infrastructure configuration). */
  readonly rpcUrl: string;
  /** Optional ENS Universal Resolver override (viem has a Sepolia default). */
  readonly universalResolverAddress: `0x${string}` | null;
}

export interface LlmConfig {
  /** Base URL of an OpenAI-compatible endpoint (infrastructure configuration). */
  readonly baseUrl: string;
  /** API key (SECRET — used only in Authorization headers, never logged). */
  readonly apiKey: string | null;
  readonly model: string;
  /** EXPLICIT timeout for every LLM call. */
  readonly timeoutMs: number;
  readonly jsonMode: boolean;
}

export interface RouterConfig {
  readonly port: number;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly ens: EnsConfig;
  readonly llm: LlmConfig;
  /** EXPLICIT timeout for every router -> agent HTTP call (CHECK 5). */
  readonly agentRequestTimeoutMs: number;
  /**
   * Development exception for CHECK 6: when true, plain http:// is accepted
   * for loopback hosts (localhost / 127.0.0.1) only. Production ENS records
   * must use HTTPS.
   */
  readonly allowLocalhostEndpoints: boolean;
  /** 0 = discover fresh from ENS on every request; > 0 = TTL cache (ms). */
  readonly discoveryCacheTtlMs: number;
}

export class ConfigurationError extends Error {
  public override readonly name = 'ConfigurationError';
}

const NODE_ENV_VALUES = new Set(['development', 'production', 'test']);
const UNIVERSAL_RESOLVER_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readOptionalEnv(name, env);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = readOptionalEnv(name, env);
  if (raw === undefined) {
    return fallback;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  throw new ConfigurationError(`${name} must be "true" or "false".`);
}

/**
 * Load and validate the router configuration from the environment.
 * Throws {@link ConfigurationError} with a clear message when required values
 * are missing or malformed.
 */
export function loadRouterConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig {
  const missing: string[] = [];

  const directoryName = readOptionalEnv('ENS_DIRECTORY_NAME', env);
  if (directoryName === undefined) {
    missing.push('ENS_DIRECTORY_NAME');
  }
  const rpcUrl = readOptionalEnv('SEPOLIA_RPC_URL', env);
  if (rpcUrl === undefined) {
    missing.push('SEPOLIA_RPC_URL');
  }

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill in the values.`,
    );
  }

  const universalResolverRaw = readOptionalEnv('ENS_UNIVERSAL_RESOLVER_ADDRESS', env);
  let universalResolverAddress: `0x${string}` | null = null;
  if (universalResolverRaw !== undefined) {
    if (!UNIVERSAL_RESOLVER_PATTERN.test(universalResolverRaw)) {
      throw new ConfigurationError(
        'ENS_UNIVERSAL_RESOLVER_ADDRESS must be a 20-byte hex address starting with 0x.',
      );
    }
    universalResolverAddress = universalResolverRaw as `0x${string}`;
  }

  const nodeEnvRaw = readOptionalEnv('NODE_ENV', env) ?? 'development';
  const nodeEnv = NODE_ENV_VALUES.has(nodeEnvRaw)
    ? (nodeEnvRaw as RouterConfig['nodeEnv'])
    : 'development';

  const llmTimeoutMs = readPositiveInt(env, 'LLM_TIMEOUT_MS', 15_000, 100, 120_000);
  const agentRequestTimeoutMs = readPositiveInt(env, 'AGENT_REQUEST_TIMEOUT_MS', 8_000, 100, 120_000);
  const discoveryCacheTtlMs = readPositiveInt(env, 'DISCOVERY_CACHE_TTL_MS', 0, 0, 3_600_000);
  const port = readPositiveInt(env, 'ROUTER_PORT', 8_787, 1, 65_535);

  return {
    port,
    nodeEnv,
    ens: {
      // router narrowing: directoryName is defined when `missing` is empty.
      directoryName: directoryName as string,
      rpcUrl: rpcUrl as string,
      universalResolverAddress,
    },
    llm: {
      baseUrl: readOptionalEnv('LLM_BASE_URL', env) ?? 'https://api.openai.com/v1',
      // SECRET: kept in config only for the Authorization header, never logged.
      apiKey: readOptionalEnv('LLM_API_KEY', env) ?? null,
      model: readOptionalEnv('LLM_MODEL', env) ?? 'gpt-4o-mini',
      timeoutMs: llmTimeoutMs,
      jsonMode: true,
    },
    agentRequestTimeoutMs,
    // Development exception (CHECK 6 / SSRF hardening): plain http:// loopback
    // endpoints are a development/testing convenience ONLY. In production the
    // exception is ALWAYS forced off — production ENS records must use HTTPS —
    // so an ENS record can never be used to reach internal services over http.
    allowLocalhostEndpoints:
      nodeEnv === 'production' ? false : readBoolean(env, 'ALLOW_LOCALHOST_ENDPOINTS', true),
    discoveryCacheTtlMs,
  };
}
