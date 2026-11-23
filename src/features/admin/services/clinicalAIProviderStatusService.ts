import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import {
  CLINICAL_AI_PROVIDERS,
  type ClinicalAIProvider,
} from '@/features/admin/domain/clinicalAIProviderRouting';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

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
const PROVIDER_STATUS_TIMEOUT_MS = 10_000;
const PROVIDER_TEST_TIMEOUT_MS = 20_000;

const isClinicalAIProvider = (value: unknown): value is ClinicalAIProvider =>
  typeof value === 'string' && CLINICAL_AI_PROVIDERS.includes(value as ClinicalAIProvider);

const readJsonObjectOrNull = async (
  response: Response
): Promise<Record<string, unknown> | null> => {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const getClinicalAIProviderStatuses = async (
  endpoint: string = DEFAULT_STATUS_ENDPOINT
): Promise<ClinicalAIProviderStatus[]> => {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetchWithTimeout(endpoint, {
    method: 'GET',
    headers: {
      ...authHeaders,
    },
    timeoutMs: PROVIDER_STATUS_TIMEOUT_MS,
    timeoutMessage: 'La consulta del estado de proveedores IA tardó demasiado en responder.',
  });

  if (!response.ok) {
    throw new Error('No se pudo cargar el estado de proveedores IA.');
  }

  const payload = await readJsonObjectOrNull(response);
  if (!payload) {
    throw new Error('La respuesta del estado de proveedores IA no es válida.');
  }
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
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(request),
    timeoutMs: PROVIDER_TEST_TIMEOUT_MS,
    timeoutMessage: 'La prueba del proveedor IA tardó demasiado en responder.',
  });

  const payload = (await readJsonObjectOrNull(
    response
  )) as Partial<ClinicalAIProviderTestResult> | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.message === 'string' && payload.message
        ? payload.message
        : 'No se pudo probar el proveedor IA.'
    );
  }
  if (!payload) {
    throw new Error('La respuesta de prueba del proveedor IA no es válida.');
  }

  return {
    ok: Boolean(payload.ok),
    provider: isClinicalAIProvider(payload.provider) ? payload.provider : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
    message: typeof payload.message === 'string' ? payload.message : 'Provider test finished',
  };
};
