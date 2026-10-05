/**
 * aiProviderConfig
 *
 * Shared AI provider detection for local development.
 * Used by both CIE-10 and FONASA AI search services.
 *
 * Checks for API keys in this priority order:
 *  1. Explicit provider via VITE_LOCAL_AI_PROVIDER
 *  2. Gemini (VITE_LOCAL_GEMINI_API_KEY)
 *  3. OpenAI (VITE_LOCAL_OPENAI_API_KEY)
 *  4. Anthropic (VITE_LOCAL_ANTHROPIC_API_KEY)
 */

export type LocalAIProvider = 'gemini' | 'openai' | 'anthropic';

export interface LocalAIProviderConfig {
  provider: LocalAIProvider;
  apiKey: string;
}

/**
 * Detects the available local AI provider from environment variables.
 * Returns null in production or when no API key is configured.
 */
export const getLocalDevProviderConfig = (): LocalAIProviderConfig | null => {
  if (!import.meta.env.DEV) return null;

  const explicitProvider = import.meta.env.VITE_LOCAL_AI_PROVIDER;
  const geminiKey = import.meta.env.VITE_LOCAL_GEMINI_API_KEY?.trim();
  const openaiKey = import.meta.env.VITE_LOCAL_OPENAI_API_KEY?.trim();
  const anthropicKey = import.meta.env.VITE_LOCAL_ANTHROPIC_API_KEY?.trim();

  const buildConfig = (provider: LocalAIProvider, apiKey?: string | null) =>
    apiKey ? { provider, apiKey } : null;

  if (explicitProvider === 'gemini') return buildConfig('gemini', geminiKey);
  if (explicitProvider === 'openai') return buildConfig('openai', openaiKey);
  if (explicitProvider === 'anthropic') return buildConfig('anthropic', anthropicKey);

  return (
    buildConfig('gemini', geminiKey) ||
    buildConfig('openai', openaiKey) ||
    buildConfig('anthropic', anthropicKey)
  );
};

/**
 * Whether any local AI provider is configured (dev only).
 */
export const isLocalAIAvailable = (): boolean => !!getLocalDevProviderConfig();

/**
 * Calls a local AI provider with a prompt and returns the raw text response.
 * Supports Gemini, OpenAI, and Anthropic APIs.
 *
 * @param prompt - The full prompt text to send.
 * @returns Raw text response from the AI provider, or empty string on failure.
 */
export const callLocalAI = async (prompt: string): Promise<string> => {
  // A build-time guard keeps local-only providers out of the production bundle.
  if (!import.meta.env.DEV) return '';
  const config = getLocalDevProviderConfig();
  if (!config) return '';

  try {
    if (config.provider === 'gemini') {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      return response.text?.trim() ?? '';
    }

    if (config.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            { role: 'system', content: 'Responde solo con JSON válido.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!response.ok) return '';
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return typeof payload.choices?.[0]?.message?.content === 'string'
        ? payload.choices[0].message.content
        : '';
    }

    // Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 700,
        temperature: 0.2,
        system: 'Responde solo con JSON válido.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return '';
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (
      payload.content
        ?.map(item => (item.type === 'text' ? item.text || '' : ''))
        .join('\n')
        .trim() || ''
    );
  } catch {
    return '';
  }
};
