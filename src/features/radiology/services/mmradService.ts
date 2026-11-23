/**
 * MMRAD RIS Service
 * Fetches radiology exam data from the MMRAD RIS system via Netlify Function.
 */

import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { sessionEpochGuard } from '@/services/session/sessionStorageTransition';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { MMRADReportSections } from '@/domain/radiology/mmradReportSupport';
import { formatRut } from '@/utils/rutUtils';

const mmradLogger = createScopedLogger('mmradService');
const MMRAD_SEARCH_TIMEOUT_MS = 45_000;
const MMRAD_RECEIPT_TIMEOUT_MS = 25_000;
const MMRAD_PDF_TIMEOUT_MS = 30_000;

const createTimedAbortSignal = (
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('La consulta a MMRAD superó el tiempo de espera.', 'AbortError')
      ),
    timeoutMs
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
};

export interface MMRADExam {
  nombre_examen: string;
  fecha_examen: string;
  fecha_asignacion: string;
  mod: string;
  estado: string;
  pdf_url: string | null;
  dicom_url: string | null;
  informe_html_url: string | null;
  portal_web_receipt_url?: string | null;
  report: MMRADReportSections | null;
  /**
   * Set only when MMRAD registered this exam under the patient's RUT number with another check
   * digit and the name matched. The viewer then expects this ID inside each original.
   */
  registered_patient_id?: string;
  /** The name MMRAD shows for that registration, for a person to confirm. */
  registered_patient_name?: string;
}

export interface MMRADSearchResult {
  rut: string;
  examenes: MMRADExam[];
  /** The search for mistyped check digits ran fully, or some variant failed. */
  check_digit_search?: 'complete' | 'partial';
}

export const describeMMRADRegisteredPatient = (
  registeredPatientId: string,
  registeredPatientName?: string
): string =>
  `MMRAD registró este examen con el RUT ${formatRut(registeredPatientId)}${
    registeredPatientName ? `, a nombre de ${registeredPatientName}` : ''
  }, que difiere solo en el dígito verificador. Se muestra porque coinciden el número y el nombre; confirma que es el mismo paciente.`;

export interface MMRADSearchParams {
  rut: string;
  /** Census name; lets the search include exams MMRAD registered with a mistyped check digit. */
  patientName?: string;
  /** ISO format YYYY-MM-DD */
  dateFrom?: string;
  /** ISO format YYYY-MM-DD */
  dateTo?: string;
}

const buildMMRADProxyUrl = (query: string): string => `/.netlify/functions/mmrad-search${query}`;

const resolveMmradUserFacingError = (message: string): string => {
  if (message.includes('Acceso denegado para MMRAD')) {
    return `${message} En desarrollo local, entra por http://localhost:8888/ y vuelve a iniciar sesión si cambiaste de entorno.`;
  }

  return message;
};

export const buildMMRADPdfUrl = (pdfLink: string): string =>
  buildMMRADProxyUrl(`?action=pdf&link=${encodeURIComponent(pdfLink)}`);

export const buildMMRADPortalReceiptUrl = (receiptLink: string): string =>
  buildMMRADProxyUrl(`?action=portalReceipt&link=${encodeURIComponent(receiptLink)}`);

export const fetchMMRADPdfBlob = async (
  pdfLink: string,
  signal?: AbortSignal,
  options?: { cache?: RequestCache }
): Promise<Blob> => {
  const isSessionShown = sessionEpochGuard();
  const authHeaders = await resolveCurrentUserAuthHeaders();
  signal?.throwIfAborted();
  if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');

  const timed = signal ? null : createTimedAbortSignal(MMRAD_PDF_TIMEOUT_MS);
  const requestSignal = signal ?? timed?.signal;
  try {
    const response = await fetch(buildMMRADPdfUrl(pdfLink), {
      headers: authHeaders,
      signal: requestSignal,
      ...(options?.cache ? { cache: options.cache } : {}),
    });

    if (!response.ok) {
      throw new Error('No se pudo obtener el PDF original de MMRAD.');
    }

    const pdfBlob = await response.blob();
    requestSignal?.throwIfAborted();
    if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');
    if (pdfBlob.type.split(';')[0]?.trim().toLowerCase() !== 'application/pdf') {
      throw new Error('MMRAD no devolvió un PDF original válido.');
    }
    return pdfBlob;
  } finally {
    timed?.cleanup();
  }
};

export const fetchMMRADPortalReceiptHtml = async (
  receiptLink: string,
  signal?: AbortSignal
): Promise<string> => {
  const isSessionShown = sessionEpochGuard();
  const authHeaders = await resolveCurrentUserAuthHeaders();
  signal?.throwIfAborted();
  if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');

  const timed = createTimedAbortSignal(MMRAD_RECEIPT_TIMEOUT_MS, signal);
  try {
    const response = await fetch(buildMMRADPortalReceiptUrl(receiptLink), {
      headers: authHeaders,
      signal: timed.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(error => {
        mmradLogger.warn('Failed to parse MMRAD portal receipt error response body', error);
        return { error: 'Error de conexión' };
      });
      throw new Error(errorData.error || `Error ${response.status}`);
    }

    const html = await response.text();
    timed.signal.throwIfAborted();
    if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');
    return html;
  } finally {
    timed.cleanup();
  }
};

/**
 * Exams MMRAD registered under this RUT number with another check digit, checked against the
 * census name. Slower than the exact search, so the viewer asks for both at once.
 */
export const searchMMRADCheckDigitExams = (
  params: MMRADSearchParams & { patientName: string },
  signal?: AbortSignal
): Promise<MMRADSearchResult> => searchMMRADExams(params, 'check-digit', signal);

export const searchMMRADExams = async (
  { rut, patientName, dateFrom, dateTo }: MMRADSearchParams,
  action?: 'check-digit',
  signal?: AbortSignal
): Promise<MMRADSearchResult> => {
  const isSessionShown = sessionEpochGuard();
  const cleanRut = rut.replace(/\./g, '').trim();
  const authHeaders = await resolveCurrentUserAuthHeaders();
  signal?.throwIfAborted();
  if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');

  let url = buildMMRADProxyUrl(
    `?${action ? `action=${action}&` : ''}rut=${encodeURIComponent(cleanRut)}`
  );
  if (dateFrom) url += `&from=${encodeURIComponent(dateFrom)}`;
  if (dateTo) url += `&to=${encodeURIComponent(dateTo)}`;
  if (patientName?.trim()) url += `&name=${encodeURIComponent(patientName.trim())}`;

  const timed = createTimedAbortSignal(MMRAD_SEARCH_TIMEOUT_MS, signal);
  try {
    const response = await fetch(url, {
      headers: authHeaders,
      signal: timed.signal,
    });

    // Detect when Vite dev server returns HTML instead of JSON (Netlify Functions not available)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(
        'Servidor MMRAD no disponible. En desarrollo local, usa "netlify dev" en vez de "npm run dev" para habilitar las funciones de Netlify.'
      );
    }

    if (!response.ok) {
      const errorData = await response.json().catch(error => {
        mmradLogger.warn('Failed to parse MMRAD error response body', error);
        return { error: 'Error de conexión' };
      });
      throw new Error(resolveMmradUserFacingError(errorData.error || `Error ${response.status}`));
    }

    const result = (await response.json()) as MMRADSearchResult;
    timed.signal.throwIfAborted();
    if (!isSessionShown()) throw new DOMException('Consulta cancelada.', 'AbortError');
    return result;
  } catch (error) {
    mmradLogger.error('MMRAD search failed', error);
    throw error;
  } finally {
    timed.cleanup();
  }
};
