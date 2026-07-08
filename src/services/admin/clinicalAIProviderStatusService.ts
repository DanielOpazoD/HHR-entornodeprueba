import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import {
  CLINICAL_AI_PROVIDERS,
  type ClinicalAIProvider,
} from '@/shared/ai/clinicalAIProviderRouting';

export interface ClinicalAIProviderStatus {
  provider: ClinicalAIProvider;
  configured: boolean;
  model: string;
}

export interface ClinicalAIProviderTestRequest {
  action: string;
  provider: ClinicalAIProvider;
  model?: string | null;
}

export interface ClinicalAIProviderTestResult {
  ok: boolean;
  provider?: ClinicalAIProvider;
  model?: string;
  message: string;
}

const DEFAULT_STATUS_ENDPOINT = '/.netlify/functions/admin-ai-provider-status';
const DEFAULT_TEST_ENDPOINT = '/.netlify/functions/admin-ai-provider-test';

const isClinicalAIProvider = (value: unknown): value is ClinicalAIProvider =>
  typeof value === 'string' && CLINICAL_AI_PROVIDERS.includes(value as ClinicalAIProvider);

export const getClinicalAIProviderStatuses = async (
  endpoint: string = DEFAULT_STATUS_ENDPOINT
): Promise<ClinicalAIProviderStatus[]> => {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error('No se pudo cargar el estado de proveedores IA.');
  }

  const payload = (await response.json()) as { providers?: unknown };
  if (!Array.isArray(payload.providers)) {
    return [];
  }

  return payload.providers
    .filter(
      (
        provider
      ): provider is { provider: ClinicalAIProvider; configured: boolean; model: string } =>
        Boolean(provider) &&
        typeof provider === 'object' &&
        isClinicalAIProvider((provider as { provider?: unknown }).provider)
    )
    .map(provider => ({
      provider: provider.provider,
      configured: Boolean(provider.configured),
      model: typeof provider.model === 'string' ? provider.model : '',
    }));
};

export const testClinicalAIProvider = async (
  request: ClinicalAIProviderTestRequest,
  endpoint: string = DEFAULT_TEST_ENDPOINT
): Promise<ClinicalAIProviderTestResult> => {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(request),
  });

  const payload = (await response.json()) as Partial<ClinicalAIProviderTestResult>;
  if (!response.ok) {
    throw new Error(payload.message || 'No se pudo probar el proveedor IA.');
  }

  return {
    ok: Boolean(payload.ok),
    provider: isClinicalAIProvider(payload.provider) ? payload.provider : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
    message: typeof payload.message === 'string' ? payload.message : 'Provider test finished',
  };
};
