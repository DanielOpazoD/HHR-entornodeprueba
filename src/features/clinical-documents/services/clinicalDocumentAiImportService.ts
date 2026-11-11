import {
  ClinicalDocumentAiImportRequestSchema,
  ClinicalDocumentAiImportResponseSchema,
  getServerlessErrorMessage,
  type ClinicalDocumentAiImportPayload,
} from '@/shared/contracts/serverless';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import {
  createApplicationFailed,
  createApplicationIssue,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

const resolveEndpoint = (): string =>
  import.meta.env.VITE_CLINICAL_DOCUMENT_AI_IMPORT_ENDPOINT ||
  '/.netlify/functions/clinical-document-ai-import';

const LOCAL_ENDPOINT_UNAVAILABLE_MESSAGE =
  'El endpoint local de IA no está disponible. Reinicia el servidor de desarrollo e intenta nuevamente.';

const isJsonResponse = (response: Response): boolean =>
  response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false;

const readServerlessPayload = async (response: Response): Promise<unknown> => {
  if (isJsonResponse(response)) {
    return response.json();
  }

  if (response.status === 404) {
    return { error: LOCAL_ENDPOINT_UNAVAILABLE_MESSAGE };
  }

  return { error: 'No se pudo leer la respuesta del servicio de IA.' };
};

const buildFailedImportOutcome = (
  message: string
): ApplicationOutcome<ClinicalDocumentAiImportPayload | null> =>
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

export const transformClinicalDocumentAiImportText = async (
  sourceText: string
): Promise<ApplicationOutcome<ClinicalDocumentAiImportPayload | null>> => {
  try {
    const request = ClinicalDocumentAiImportRequestSchema.parse({ sourceText });
    const authHeaders = await resolveCurrentUserAuthHeaders();
    const response = await fetch(resolveEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(request),
    });
    const payload = await readServerlessPayload(response);

    if (!response.ok) {
      return buildFailedImportOutcome(
        getServerlessErrorMessage(payload, 'No se pudo transformar el documento con IA.')
      );
    }

    const parsed = ClinicalDocumentAiImportResponseSchema.parse(payload);
    if (!parsed.available) {
      return buildFailedImportOutcome(parsed.message || 'La IA no está configurada.');
    }
    if (!parsed.document) {
      return buildFailedImportOutcome('La IA no devolvió una epicrisis de traslado válida.');
    }

    return createApplicationSuccess(parsed.document);
  } catch (error) {
    return buildFailedImportOutcome(
      error instanceof Error ? error.message : 'No se pudo transformar el documento con IA.'
    );
  }
};
