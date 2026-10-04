/**
 * Minimal OpenAI-compatible chat-completions client (fetch-based, zero SDK).
 *
 * SECURITY: the API key is sent ONLY in the Authorization header and is never
 * logged, embedded in error messages, or written to telemetry. Every request
 * has an EXPLICIT AbortController timeout (challenge CHECK 5 applies to all
 * outbound HTTP calls, not just agent forwarding).
 */
import { describeError } from '../security/secrets.js';

export interface LlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/** Minimal LLM seam: send messages, get the raw assistant text back. */
export interface LlmClient {
  complete(messages: readonly LlmMessage[]): Promise<string>;
}

export type LlmFailureReason =
  | 'timeout'
  | 'http_error'
  | 'malformed_response'
  | 'network_error';

export class LlmRequestError extends Error {
  public override readonly name = 'LlmRequestError';

  public constructor(
    public readonly reason: LlmFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface OpenAiCompatibleLlmOptions {
  /** Base URL of an OpenAI-compatible chat-completions endpoint. */
  readonly baseUrl: string;
  /** API key — sent ONLY in the Authorization header, never logged. */
  readonly apiKey: string;
  readonly model: string;
  /** EXPLICIT timeout in milliseconds for every LLM call. */
  readonly timeoutMs: number;
  /** Request strict JSON output mode (response_format json_object). */
  readonly jsonMode: boolean;
}

/** Create the live LLM client (any OpenAI-compatible endpoint). */
export function createOpenAiCompatibleLlmClient(options: OpenAiCompatibleLlmOptions): LlmClient {
  return {
    async complete(messages: readonly LlmMessage[]): Promise<string> {
      // The base URL is infrastructure configuration (never an agent URL).
      const endpointUrl = new URL(
        'chat/completions',
        options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`,
      );

      // Explicit timeout (CHECK 5): never rely on client defaults.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // SECURITY: the key is only ever placed here — never logged.
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            messages,
            ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Status code is safe to log; the key is not part of it.
          throw new LlmRequestError(
            'http_error',
            `LLM endpoint responded with HTTP ${response.status}.`,
          );
        }

        let bodyText: string;
        try {
          bodyText = await response.text();
        } catch (cause) {
          throw new LlmRequestError('network_error', 'Could not read the LLM response body.', {
            cause,
          });
        }

        let bodyJson: unknown;
        try {
          bodyJson = JSON.parse(bodyText);
        } catch (cause) {
          throw new LlmRequestError('malformed_response', 'LLM response body is not valid JSON.', {
            cause,
          });
        }

        const content = extractAssistantContent(bodyJson);
        if (content === null) {
          throw new LlmRequestError(
            'malformed_response',
            'LLM response did not contain assistant message content.',
          );
        }
        return content;
      } catch (cause) {
        if (cause instanceof LlmRequestError) {
          throw cause;
        }
        if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
          throw new LlmRequestError(
            'timeout',
            `LLM request timed out after ${options.timeoutMs} ms.`,
            { cause },
          );
        }
        throw new LlmRequestError('network_error', 'LLM request failed.', { cause });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** Extract choices[0].message.content from an unknown response body. */
function extractAssistantContent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    return null;
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

/** Describe an LLM failure safely (no secrets; the key is never included). */
export function describeLlmFailure(cause: unknown): string {
  return describeError(cause);
}
