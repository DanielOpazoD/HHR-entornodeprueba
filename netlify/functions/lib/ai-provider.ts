import { GoogleGenAI } from '@google/genai';

export type ClinicalAIProvider = 'gemini' | 'openai' | 'anthropic' | 'deepseek';
export type ClinicalAIAction =
  | 'clinical_ai_summary'
  | 'clinical_document_import'
  | 'cie10_search'
  | 'clinical_attachment_name_suggestion';

export interface ClinicalAIRoutingRule {
  enabled?: boolean;
  provider?: ClinicalAIProvider | null;
  model?: string | null;
}

export interface ClinicalAIRoutingConfig {
  actions?: Partial<Record<ClinicalAIAction, ClinicalAIRoutingRule | null>>;
}

export interface ClinicalAIProviderAvailability {
  provider: ClinicalAIProvider;
  configured: boolean;
  model: string;
  endpoint?: string;
}

export interface ClinicalAIProviderConfig {
  provider: ClinicalAIProvider;
  apiKey: string;
  model: string;
  endpoint?: string;
}

export interface GenerateClinicalAITextParams {
  config: ClinicalAIProviderConfig;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_PROVIDER_MODELS: Record<ClinicalAIProvider, string> = {
  gemini: 'gemini-3-flash-preview',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  deepseek: 'deepseek-chat',
};

const normalizeProvider = (value: string | undefined): ClinicalAIProvider | null => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'gemini' ||
    normalized === 'openai' ||
    normalized === 'anthropic' ||
    normalized === 'deepseek'
  ) {
    return normalized;
  }
  return null;
};

interface ResolveClinicalAIProviderConfigOptions {
  env?: NodeJS.ProcessEnv;
  action?: ClinicalAIAction;
  routingConfig?: ClinicalAIRoutingConfig | null;
}

const normalizeResolveOptions = (
  input?: NodeJS.ProcessEnv | ResolveClinicalAIProviderConfigOptions
): Required<Pick<ResolveClinicalAIProviderConfigOptions, 'env'>> &
  Omit<ResolveClinicalAIProviderConfigOptions, 'env'> => {
  const maybeOptions = input as ResolveClinicalAIProviderConfigOptions | undefined;
  const isOptionsObject =
    Boolean(input) &&
    typeof input === 'object' &&
    ('action' in input || 'routingConfig' in input || typeof maybeOptions?.env === 'object');

  if (!input || !isOptionsObject) {
    return { env: (input as NodeJS.ProcessEnv | undefined) ?? process.env };
  }

  return {
    env: maybeOptions?.env ?? process.env,
    action: maybeOptions?.action,
    routingConfig: maybeOptions?.routingConfig,
  };
};

const resolveChatCompletionsEndpoint = (baseUrl: string | undefined, defaultBaseUrl: string) => {
  const normalized = (baseUrl?.trim() || defaultBaseUrl).replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
};

const getProviderApiKey = (provider: ClinicalAIProvider, env: NodeJS.ProcessEnv) => {
  if (provider === 'gemini') return env.GEMINI_API_KEY || env.API_KEY;
  if (provider === 'openai') return env.OPENAI_API_KEY;
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY;
  return env.DEEPSEEK_API_KEY;
};

const getProviderModel = (provider: ClinicalAIProvider, env: NodeJS.ProcessEnv) => {
  if (provider === 'gemini') return env.GEMINI_MODEL;
  if (provider === 'openai') return env.OPENAI_MODEL;
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL;
  return env.DEEPSEEK_MODEL;
};

const getProviderEndpoint = (
  provider: ClinicalAIProvider,
  env: NodeJS.ProcessEnv
): string | undefined => {
  if (provider === 'openai') {
    return resolveChatCompletionsEndpoint(
      env.OPENAI_BASE_URL,
      'https://api.openai.com/v1/chat/completions'
    );
  }
  if (provider === 'deepseek') {
    return resolveChatCompletionsEndpoint(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
  }
  return undefined;
};

export const listClinicalAIProviderAvailability = (
  env: NodeJS.ProcessEnv = process.env
): ClinicalAIProviderAvailability[] =>
  (['gemini', 'openai', 'anthropic', 'deepseek'] as const).map(provider => ({
    provider,
    configured: Boolean(getProviderApiKey(provider, env)?.trim()),
    model: getProviderModel(provider, env)?.trim() || DEFAULT_PROVIDER_MODELS[provider],
    endpoint: getProviderEndpoint(provider, env),
  }));

export const resolveClinicalAIProviderConfig = (
  input?: NodeJS.ProcessEnv | ResolveClinicalAIProviderConfigOptions
): ClinicalAIProviderConfig | null => {
  const { env, action, routingConfig } = normalizeResolveOptions(input);
  const explicitProvider = normalizeProvider(env.AI_PROVIDER);
  const actionRule = action ? routingConfig?.actions?.[action] : null;

  const buildConfig = (
    provider: ClinicalAIProvider,
    model?: string | null
  ): ClinicalAIProviderConfig | null => {
    const apiKey = getProviderApiKey(provider, env);
    if (!apiKey?.trim()) {
      return null;
    }

    return {
      provider,
      apiKey: apiKey.trim(),
      model:
        model?.trim() ||
        getProviderModel(provider, env)?.trim() ||
        DEFAULT_PROVIDER_MODELS[provider],
      endpoint: getProviderEndpoint(provider, env),
    };
  };

  if (actionRule && actionRule.enabled === false) {
    return null;
  }

  const routedProvider = normalizeProvider(actionRule?.provider ?? undefined);
  if (routedProvider) {
    return buildConfig(routedProvider, actionRule?.model);
  }

  if (explicitProvider === 'gemini') {
    return buildConfig('gemini');
  }
  if (explicitProvider === 'openai') {
    return buildConfig('openai');
  }
  if (explicitProvider === 'anthropic') {
    return buildConfig('anthropic');
  }
  if (explicitProvider === 'deepseek') {
    return buildConfig('deepseek');
  }

  if (action === 'clinical_attachment_name_suggestion') {
    return (
      buildConfig('deepseek') ||
      buildConfig('gemini') ||
      buildConfig('openai') ||
      buildConfig('anthropic')
    );
  }

  return (
    buildConfig('gemini') ||
    buildConfig('openai') ||
    buildConfig('anthropic') ||
    buildConfig('deepseek')
  );
};

const parseOpenAIContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const text = (item as { text?: string }).text;
          if (typeof text === 'string') return text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
};

const parseAnthropicContent = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const block = item as { type?: string; text?: string };
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .join('\n')
    .trim();
};

const generateGeminiText = async ({
  config,
  systemPrompt,
  userPrompt,
}: GenerateClinicalAITextParams): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await ai.models.generateContent({
    model: config.model,
    contents: `${systemPrompt}\n\n${userPrompt}`,
  });

  return response.text?.trim() || '';
};

const generateOpenAICompatibleText = async ({
  config,
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  maxTokens = 1200,
}: GenerateClinicalAITextParams): Promise<string> => {
  const response = await fetch(config.endpoint || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${config.provider} request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  return parseOpenAIContent(payload.choices?.[0]?.message?.content);
};

const generateAnthropicText = async ({
  config,
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  maxTokens = 1200,
}: GenerateClinicalAITextParams): Promise<string> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: systemPrompt,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as {
    content?: unknown;
  };

  return parseAnthropicContent(payload.content);
};

export const generateClinicalAIText = async (
  params: GenerateClinicalAITextParams
): Promise<string> => {
  if (params.config.provider === 'gemini') {
    return generateGeminiText(params);
  }

  if (params.config.provider === 'openai') {
    return generateOpenAICompatibleText(params);
  }

  if (params.config.provider === 'deepseek') {
    return generateOpenAICompatibleText(params);
  }

  return generateAnthropicText(params);
};
