import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => generateContentMock(...args),
    };
  },
}));

import {
  generateClinicalAIText,
  listClinicalAIProviderAvailability,
  resolveClinicalAIProviderConfig,
} from '../../../netlify/functions/lib/ai-provider';

describe('ai-provider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it('resolves the explicitly configured provider', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';

    expect(resolveClinicalAIProviderConfig()).toMatchObject({
      provider: 'openai',
      apiKey: 'openai-key',
    });
  });

  it('reports DeepSeek availability from Netlify environment secrets', () => {
    const availability = listClinicalAIProviderAvailability({
      DEEPSEEK_API_KEY: 'deepseek-key',
      DEEPSEEK_MODEL: 'deepseek-chat',
    } as NodeJS.ProcessEnv);

    expect(availability).toContainEqual(
      expect.objectContaining({
        provider: 'deepseek',
        configured: true,
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/chat/completions',
      })
    );
  });

  it('resolves a DeepSeek provider selected for a specific clinical AI action', () => {
    const config = resolveClinicalAIProviderConfig({
      env: {
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL: 'deepseek-reasoner',
        GEMINI_API_KEY: 'gemini-key',
      } as NodeJS.ProcessEnv,
      action: 'clinical_document_import',
      routingConfig: {
        actions: {
          clinical_document_import: {
            enabled: true,
            provider: 'deepseek',
          },
        },
      },
    });

    expect(config).toMatchObject({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-reasoner',
      endpoint: 'https://api.deepseek.com/chat/completions',
    });
  });

  it('prefers DeepSeek for clinical attachment name suggestions by default', () => {
    const config = resolveClinicalAIProviderConfig({
      env: {
        DEEPSEEK_API_KEY: 'deepseek-key',
        GEMINI_API_KEY: 'gemini-key',
      } as NodeJS.ProcessEnv,
      action: 'clinical_attachment_name_suggestion',
    });

    expect(config).toMatchObject({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-chat',
    });
  });

  it('does not silently fallback when an action selects a provider without a configured key', () => {
    const config = resolveClinicalAIProviderConfig({
      env: {
        GEMINI_API_KEY: 'gemini-key',
      } as NodeJS.ProcessEnv,
      action: 'clinical_ai_summary',
      routingConfig: {
        actions: {
          clinical_ai_summary: {
            enabled: true,
            provider: 'deepseek',
          },
        },
      },
    });

    expect(config).toBeNull();
  });

  it('generates text with Gemini', async () => {
    generateContentMock.mockResolvedValue({ text: 'respuesta gemini' });

    const result = await generateClinicalAIText({
      config: {
        provider: 'gemini',
        apiKey: 'gemini-key',
        model: 'gemini-3-flash-preview',
      },
      systemPrompt: 'Sistema',
      userPrompt: 'Usuario',
    });

    expect(result).toBe('respuesta gemini');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('generates text with OpenAI', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'respuesta openai' } }],
      }),
    } as Response);

    const result = await generateClinicalAIText({
      config: {
        provider: 'openai',
        apiKey: 'openai-key',
        model: 'gpt-4o-mini',
      },
      systemPrompt: 'Sistema',
      userPrompt: 'Usuario',
    });

    expect(result).toBe('respuesta openai');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('generates text with DeepSeek through its OpenAI-compatible endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'respuesta deepseek' } }],
      }),
    } as Response);

    const result = await generateClinicalAIText({
      config: {
        provider: 'deepseek',
        apiKey: 'deepseek-key',
        model: 'deepseek-chat',
        endpoint: 'https://api.deepseek.com/chat/completions',
      },
      systemPrompt: 'Sistema',
      userPrompt: 'Usuario',
    });

    expect(result).toBe('respuesta deepseek');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer deepseek-key',
        }),
      })
    );
  });

  it('generates text with Anthropic', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'respuesta anthropic' }],
      }),
    } as Response);

    const result = await generateClinicalAIText({
      config: {
        provider: 'anthropic',
        apiKey: 'anthropic-key',
        model: 'claude-3-5-sonnet-latest',
      },
      systemPrompt: 'Sistema',
      userPrompt: 'Usuario',
    });

    expect(result).toBe('respuesta anthropic');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
