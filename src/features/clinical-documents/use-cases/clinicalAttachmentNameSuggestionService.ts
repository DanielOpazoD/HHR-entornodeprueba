import {
  ClinicalAttachmentNameSuggestionRequestSchema,
  ClinicalAttachmentNameSuggestionResponseSchema,
  getServerlessErrorMessage,
} from '@/shared/contracts/serverless';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import {
  createApplicationFailed,
  createApplicationIssue,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

const ATTACHMENT_NAME_SUGGESTION_TIMEOUT_MS = 20_000;

const resolveEndpoint = (): string =>
  import.meta.env.VITE_CLINICAL_ATTACHMENT_NAME_SUGGESTION_ENDPOINT ||
  '/.netlify/functions/clinical-attachment-name-suggestion';

const isJsonResponse = (response: Response): boolean =>
  response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false;

const readServerlessPayload = async (response: Response): Promise<unknown> => {
  if (isJsonResponse(response)) {
    try {
      return await response.json();
    } catch {
      return { error: 'No se pudo leer la respuesta del servicio de IA.' };
    }
  }
  if (response.status === 404) {
    return { error: 'El endpoint local de IA no está disponible.' };
  }
  return { error: 'No se pudo leer la respuesta del servicio de IA.' };
};

const buildFailedSuggestionOutcome = (message: string): ApplicationOutcome<string | null> =>
  createApplicationFailed(
    null,
    [
      createApplicationIssue('remote_blocked', message, {
        userSafeMessage: message,
        retryable: true,
      }),
    ],
    { userSafeMessage: message, retryable: true }
  );

export const suggestClinicalAttachmentDisplayName = async (
  input: unknown
): Promise<ApplicationOutcome<string | null>> => {
  try {
    const request = ClinicalAttachmentNameSuggestionRequestSchema.parse(input);
    const authHeaders = await resolveCurrentUserAuthHeaders();
    const response = await fetchWithTimeout(resolveEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(request),
      timeoutMs: ATTACHMENT_NAME_SUGGESTION_TIMEOUT_MS,
      timeoutMessage: 'La sugerencia de nombre con IA tardó demasiado en responder.',
    });
    const payload = await readServerlessPayload(response);

    if (!response.ok) {
      return buildFailedSuggestionOutcome(
        getServerlessErrorMessage(payload, 'No se pudo sugerir un nombre con IA.')
      );
    }

    const parsed = ClinicalAttachmentNameSuggestionResponseSchema.parse(payload);
    if (!parsed.available) {
      return buildFailedSuggestionOutcome(parsed.message || 'La IA no está configurada.');
    }
    if (!parsed.suggestedName) {
      return buildFailedSuggestionOutcome('La IA no devolvió un nombre válido.');
    }

    return createApplicationSuccess(parsed.suggestedName);
  } catch (error) {
    return buildFailedSuggestionOutcome(
      error instanceof Error ? error.message : 'No se pudo sugerir un nombre con IA.'
    );
  }
};
