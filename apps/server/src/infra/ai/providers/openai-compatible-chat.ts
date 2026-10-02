import type { TextModelAdapter } from '../types.js';

/** Any provider exposing an OpenAI-compatible `POST /chat/completions` with bearer auth. */
export function openAiCompatibleChat(endpoint: string): TextModelAdapter {
  return {
    async complete(model, { messages, maxTokens, json, signal }) {
      const response = await fetch(endpoint, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.model, temperature: 0, max_tokens: maxTokens,
          ...(json ? { response_format: { type: 'json_object' } } : {}), messages }),
      });
      if (!response.ok) throw new Error('Model unavailable');
      const payload: unknown = await response.json();
      const content = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Invalid model response');
      return content;
    },
  };
}
