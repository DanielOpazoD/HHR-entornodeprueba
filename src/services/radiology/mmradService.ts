/**
 * MMRAD RIS Service
 * Fetches radiology exam data from the MMRAD RIS system via Netlify Function.
 */

import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { MMRADReportSections } from '@/services/radiology/mmradReportSupport';
import { formatRut } from '@/utils/rutUtils';

const mmradLogger = createScopedLogger('mmradService');

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

export const fetchMMRADPdfBlobUrl = async (pdfLink: string): Promise<string> => {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetch(buildMMRADPdfUrl(pdfLink), {
    headers: authHeaders,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(error => {
      mmradLogger.warn('Failed to parse MMRAD PDF error response body', error);
      return { error: 'Error de conexión' };
    });
    throw new Error(errorData.error || `Error ${response.status}`);
  }

  const pdfBlob = await response.blob();
  return URL.createObjectURL(pdfBlob);
};

export const fetchMMRADPortalReceiptHtml = async (receiptLink: string): Promise<string> => {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetch(buildMMRADPortalReceiptUrl(receiptLink), {
    headers: authHeaders,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(error => {
      mmradLogger.warn('Failed to parse MMRAD portal receipt error response body', error);
      return { error: 'Error de conexión' };
    });
    throw new Error(errorData.error || `Error ${response.status}`);
  }

  return response.text();
};

export const searchMMRADExams = async ({
  rut,
  patientName,
  dateFrom,
  dateTo,
}: MMRADSearchParams): Promise<MMRADSearchResult> => {
  const cleanRut = rut.replace(/\./g, '').trim();
  const authHeaders = await resolveCurrentUserAuthHeaders();

  let url = buildMMRADProxyUrl(`?rut=${encodeURIComponent(cleanRut)}`);
  if (dateFrom) url += `&from=${encodeURIComponent(dateFrom)}`;
  if (dateTo) url += `&to=${encodeURIComponent(dateTo)}`;
  if (patientName?.trim()) url += `&name=${encodeURIComponent(patientName.trim())}`;

  try {
    const response = await fetch(url, {
      headers: authHeaders,
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

    return await response.json();
  } catch (error) {
    mmradLogger.error('MMRAD search failed', error);
    throw error;
  }
};
