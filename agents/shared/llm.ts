/**
 * Optional LLM support for specialist agents.
 *
 * Agents work WITHOUT an LLM key (deterministic domain logic is built in so
 * the pipeline can be demonstrated offline); when LLM_API_KEY is set, the
 * agent uses the same OpenAI-compatible client as the router. The key is
 * never logged. The client applies an explicit timeout to every LLM call.
 */
import { createOpenAiCompatibleLlmClient, type LlmClient } from '../../src/llm/client.js';

export function createOptionalAgentLlm(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (apiKey === undefined || apiKey === '') {
    return null;
  }
  const timeoutMs = Number(env.LLM_TIMEOUT_MS);
  return createOpenAiCompatibleLlmClient({
    baseUrl: env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
    apiKey,
    model: env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 100 ? timeoutMs : 15_000,
    jsonMode: false,
  });
}
