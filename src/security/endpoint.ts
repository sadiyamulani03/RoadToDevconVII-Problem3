/**
 * Agent endpoint validation — SECURITY BOUNDARY (challenge CHECK 6).
 *
 * Every ENS-derived endpoint string is UNTRUSTED DATA. It only becomes usable
 * after passing through this function, which:
 *
 *   1. parses it with the URL class — malformed values are rejected here;
 *   2. enforces a protocol allow-list: `https:` is always allowed; `http:` is
 *      allowed ONLY for explicit loopback hosts (localhost / 127.0.0.1) and
 *      ONLY when the development exception is enabled by configuration;
 *   3. rejects URLs with embedded credentials (authenticated URLs must never
 *      be stored in, or read from, ENS records).
 *
 * Everything else (file:, ftp:, javascript:, data:, gopher:, ...) is rejected
 * because it is not on the allow-list.
 *
 * The returned {@link AgentEndpointUrl} is a branded type: it can ONLY be
 * produced by this function, so a validated URL can never be confused with a
 * raw, unvalidated string elsewhere in the codebase.
 */

/** Restrictive protocol allow-list. Anything not listed here is rejected. */
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Explicit localhost development exception (challenge CHECK 6).
 * Only these exact hostnames may use plain http://, and only when
 * {@link EndpointValidationOptions.allowInsecureLocalhost} is true.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

declare const agentEndpointUrlBrand: unique symbol;

/**
 * A URL that has passed {@link validateAgentEndpoint}.
 * The brand makes it impossible to smuggle an unvalidated URL into code that
 * requires a validated one.
 */
export type AgentEndpointUrl = URL & { readonly [agentEndpointUrlBrand]: true };

export interface EndpointValidationOptions {
  /**
   * When true, plain `http://` is additionally accepted for loopback hosts.
   * Development/testing only — production ENS records must use HTTPS.
   */
  readonly allowInsecureLocalhost: boolean;
}

export class InvalidAgentEndpointError extends Error {
  public override readonly name = 'InvalidAgentEndpointError';

  public constructor(message: string) {
    super(message);
  }
}

/** True when the hostname is an explicit loopback host (localhost / 127.0.0.1). */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Validate an untrusted endpoint string and return it as a branded
 * {@link AgentEndpointUrl}. Throws {@link InvalidAgentEndpointError} when the
 * value is malformed, uses a disallowed protocol, or embeds credentials.
 *
 * This function is the single authority for endpoint safety; it must be called
 * BEFORE any endpoint is used for forwarding.
 */
export function validateAgentEndpoint(
  rawEndpoint: string,
  options: EndpointValidationOptions,
): AgentEndpointUrl {
  const trimmed = rawEndpoint.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidAgentEndpointError(
      `Endpoint "${safePreview(trimmed)}" is not a valid URL.`,
    );
  }

  // SECURITY: allow-list of protocols. file:, ftp:, javascript:, data:, etc.
  // are rejected because they are not in ALLOWED_PROTOCOLS.
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidAgentEndpointError(
      `Endpoint "${safePreview(trimmed)}" uses disallowed protocol "${url.protocol}". Only https: (and http: for the localhost development exception) is allowed.`,
    );
  }

  const isHttps = url.protocol === 'https:';
  if (!isHttps) {
    // Plain http: is only permitted for loopback hosts when the explicit
    // development exception is enabled.
    if (!isLoopbackHostname(url.hostname)) {
      throw new InvalidAgentEndpointError(
        `Endpoint "${safePreview(trimmed)}" uses plain http:// on a non-loopback host. HTTPS is required.`,
      );
    }
    if (!options.allowInsecureLocalhost) {
      throw new InvalidAgentEndpointError(
        `Endpoint "${safePreview(trimmed)}" uses plain http:// but the localhost development exception is disabled. HTTPS is required.`,
      );
    }
  }

  // SECURITY: an authenticated URL embedded in an ENS record must never be
  // used silently. Reject URLs that carry credentials.
  if (url.username !== '' || url.password !== '') {
    throw new InvalidAgentEndpointError(
      `Endpoint "${safePreview(trimmed)}" embeds credentials. Authenticated URLs are not allowed in ENS records.`,
    );
  }

  return url as AgentEndpointUrl;
}

/** Prevent untrusted endpoint values from being echoed verbatim in errors. */
function safePreview(value: string): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}
