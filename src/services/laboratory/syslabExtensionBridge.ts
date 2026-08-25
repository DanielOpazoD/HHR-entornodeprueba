import type {
  SyslabDetailsResponse,
  SyslabPdfDownloadProgress,
  SyslabPdfDownloadResult,
  SyslabSearchResponse,
} from '@/types/domain/labExamTypes';

const REQUEST_TYPES = {
  status: 'HHR_RAYEN_SYSLAB_STATUS_REQUEST',
  openLogin: 'HHR_RAYEN_SYSLAB_LOGIN_OPEN_REQUEST',
  search: 'HHR_RAYEN_SYSLAB_SEARCH_REQUEST',
  details: 'HHR_RAYEN_SYSLAB_DETAILS_REQUEST',
  pdf: 'HHR_RAYEN_SYSLAB_PDF_REQUEST',
  pdfBundle: 'HHR_RAYEN_SYSLAB_PDF_BUNDLE_REQUEST',
} as const;

const RESULT_TYPES = {
  status: 'HHR_RAYEN_SYSLAB_STATUS_RESULT',
  openLogin: 'HHR_RAYEN_SYSLAB_LOGIN_OPEN_RESULT',
  search: 'HHR_RAYEN_SYSLAB_SEARCH_RESULT',
  details: 'HHR_RAYEN_SYSLAB_DETAILS_RESULT',
  pdf: 'HHR_RAYEN_SYSLAB_PDF_RESULT',
  pdfBundle: 'HHR_RAYEN_SYSLAB_PDF_BUNDLE_RESULT',
} as const;

const PROGRESS_TYPES = {
  pdfBundle: 'HHR_RAYEN_SYSLAB_PDF_BUNDLE_PROGRESS',
} as const;

type SyslabExtensionOperation = keyof typeof REQUEST_TYPES;

interface SyslabExtensionResponse {
  bridgeAvailable: boolean;
  response?: Record<string, unknown>;
  error?: string;
}

export interface SyslabExtensionStatus {
  bridgeAvailable: boolean;
  connected: boolean;
  loginRequired: boolean;
  message: string;
}

export interface SyslabLoginWindowResult {
  bridgeAvailable: boolean;
  opened: boolean;
  error?: string;
}

/** Syslab searches by the numeric RUT body, without verifier digit. */
export const cleanRutForSyslab = (rut: string): string =>
  rut.replace(/\./g, '').replace(/-.*$/, '').replace(/\D/g, '').trim();

const requestExtension = (
  operation: SyslabExtensionOperation,
  payload: Record<string, unknown> = {},
  timeoutMs = 3_000,
  onProgress?: (progress: SyslabPdfDownloadProgress) => void
): Promise<SyslabExtensionResponse> =>
  new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ bridgeAvailable: false });
      return;
    }

    const reqId = `syslab-${operation}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const finish = (result: SyslabExtensionResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.reqId !== reqId) return;

      if (operation === 'pdfBundle' && data.type === PROGRESS_TYPES.pdfBundle) {
        const progress = data.progress as Record<string, unknown> | undefined;
        const phase = progress?.phase;
        if (
          onProgress &&
          (phase === 'validating' || phase === 'merging' || phase === 'downloading')
        ) {
          onProgress({
            phase,
            completed: Number(progress?.completed) || 0,
            total: Number(progress?.total) || 0,
            pageCount: Number(progress?.pageCount) || 0,
          });
        }
        return;
      }
      if (data.type !== RESULT_TYPES[operation]) return;

      finish({
        bridgeAvailable: true,
        response:
          data.response && typeof data.response === 'object'
            ? (data.response as Record<string, unknown>)
            : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    const timeoutId = setTimeout(() => finish({ bridgeAvailable: false }), timeoutMs);
    window.postMessage(
      { type: REQUEST_TYPES[operation], reqId, ...payload },
      window.location.origin
    );
  });

const responseError = (result: SyslabExtensionResponse, fallback: string): string | null => {
  if (result.error) return result.error;
  const error = result.response?.error;
  return typeof error === 'string' && error.trim() ? error : result.response ? null : fallback;
};

export const requestSyslabExtensionStatus = async (
  timeoutMs?: number
): Promise<SyslabExtensionStatus> => {
  const result = await requestExtension('status', {}, timeoutMs);
  if (!result.bridgeAvailable) {
    return {
      bridgeAvailable: false,
      connected: false,
      loginRequired: false,
      message: 'La extensión Eloísa no respondió.',
    };
  }

  const response = result.response;
  const connected = response?.connected === true;
  return {
    bridgeAvailable: true,
    connected,
    loginRequired: response?.loginRequired === true || response?.status === 'login-required',
    message:
      responseError(result, 'No se pudo comprobar Syslab.') ||
      (typeof response?.message === 'string' ? response.message : '') ||
      (connected ? 'Sesión de Syslab activa.' : 'Syslab no está disponible.'),
  };
};

export const openSyslabLoginWindow = async (): Promise<SyslabLoginWindowResult> => {
  const result = await requestExtension('openLogin');
  if (!result.bridgeAvailable) {
    return { bridgeAvailable: false, opened: false, error: 'La extensión Eloísa no respondió.' };
  }
  const error = responseError(result, 'La extensión no pudo abrir el acceso a Syslab.');
  return {
    bridgeAvailable: true,
    opened: result.response?.opened === true,
    ...(error ? { error } : {}),
  };
};

export const searchSyslabThroughExtension = async (
  rut: string
): Promise<{ bridgeAvailable: boolean; data?: SyslabSearchResponse; error?: string }> => {
  const rutBody = cleanRutForSyslab(rut);
  if (!/^\d{5,9}$/.test(rutBody)) {
    return { bridgeAvailable: true, error: 'El RUT seleccionado no es válido para Syslab.' };
  }
  const availability = await requestExtension('status', {}, 1_000);
  if (!availability.bridgeAvailable) return { bridgeAvailable: false };
  const availabilityError = responseError(availability, 'La extensión no pudo comprobar Syslab.');
  if (availabilityError) return { bridgeAvailable: true, error: availabilityError };
  if (availability.response?.connected !== true) {
    return {
      bridgeAvailable: true,
      error:
        typeof availability.response?.message === 'string'
          ? availability.response.message
          : 'Conecta Syslab desde el módulo Laboratorio de la extensión Eloísa.',
    };
  }
  const result = await requestExtension('search', { rutBody, rutDisplay: rut }, 40_000);
  if (!result.bridgeAvailable) return { bridgeAvailable: false };
  const error = responseError(result, 'La extensión no pudo consultar Syslab.');
  if (error) return { bridgeAvailable: true, error };

  const response = result.response;
  const batchId = typeof response?.batchId === 'string' ? response.batchId : '';
  const responseRutBody = cleanRutForSyslab(String(response?.rutBody || ''));
  if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId) || responseRutBody !== rutBody) {
    return {
      bridgeAvailable: true,
      error: 'Syslab no confirmó que los resultados correspondan al RUT seleccionado.',
    };
  }
  const exams = (Array.isArray(response?.exams) ? response.exams : []).filter(value =>
    /^\d+$/.test(String((value as Record<string, unknown>).id || ''))
  );
  return {
    bridgeAvailable: true,
    data: {
      success: response?.ok === true,
      data: exams.map(value => {
        const exam = value as Record<string, unknown>;
        const id = String(exam.id || '');
        return {
          id,
          link: `hhr-syslab-extension://batch/${batchId}/exam/${id}`,
          date: String(exam.date || ''),
          time: String(exam.time || ''),
          patientName: String(exam.patientName || ''),
          origin: String(exam.origin || ''),
          exams: Array.isArray(exam.exams) ? exam.exams.map(String) : [],
        };
      }),
      ...(typeof response?.error === 'string' ? { error: response.error } : {}),
    } as SyslabSearchResponse,
  };
};

export const fetchSyslabDetailsThroughExtension = async (
  links: string[]
): Promise<SyslabDetailsResponse> => {
  if (links.length === 0) throw new Error('Selecciona uno o más informes de laboratorio.');
  if (links.length > 24) throw new Error('Puedes analizar como máximo 24 informes por operación.');
  if (links.some(link => !isSyslabExtensionLink(link))) {
    throw new Error(
      'La selección de laboratorio contiene un informe no válido. Actualiza el visor.'
    );
  }
  const result = await requestExtension('details', { links }, 10 * 60_000);
  if (!result.bridgeAvailable) {
    throw new Error('La extensión Eloísa dejó de responder. Recarga HHR y vuelve a intentarlo.');
  }
  const error = responseError(result, 'La extensión no pudo leer los informes de Syslab.');
  if (error) throw new Error(error);
  const analysis = result.response?.analysis as
    | { reports?: Array<{ examId?: unknown; findings?: unknown[] }> }
    | undefined;
  const reports = Array.isArray(analysis?.reports) ? analysis.reports : [];
  const linksByExamId = new Map(links.map(link => [link.match(/\/exam\/(\d+)$/)?.[1] || '', link]));
  return {
    success: result.response?.ok === true,
    data: reports.map(report => ({
      url: linksByExamId.get(String(report.examId || '')) || '',
      findings: Array.isArray(report.findings) ? report.findings : [],
    })),
  } as SyslabDetailsResponse;
};

export const openSyslabPdfThroughExtension = async (link: string): Promise<void> => {
  const result = await requestExtension('pdf', { link }, 95_000);
  if (!result.bridgeAvailable) {
    throw new Error('La extensión Eloísa dejó de responder. Recarga HHR y vuelve a intentarlo.');
  }
  const error = responseError(result, 'La extensión no pudo abrir el informe de Syslab.');
  if (error) throw new Error(error);
  if (result.response?.ok !== true) throw new Error('Syslab no pudo abrir el informe solicitado.');
};

export const downloadSyslabPdfBundleThroughExtension = async (
  links: string[],
  onProgress?: (progress: SyslabPdfDownloadProgress) => void
): Promise<SyslabPdfDownloadResult> => {
  if (links.length === 0) throw new Error('Selecciona uno o más informes de laboratorio.');
  if (links.length > 24) throw new Error('Puedes descargar como máximo 24 informes por operación.');
  if (links.some(link => !isSyslabExtensionLink(link))) {
    throw new Error(
      'La selección de laboratorio contiene un informe no válido. Actualiza el visor.'
    );
  }

  const availability = await requestExtension('status', {}, 2_000);
  if (!availability.bridgeAvailable) {
    throw new Error('La extensión Eloísa no respondió. Recárgala y vuelve a abrir HHR.');
  }
  const availabilityError = responseError(
    availability,
    'La extensión no pudo comprobar la descarga conjunta.'
  );
  if (availabilityError) throw new Error(availabilityError);
  if (availability.response?.pdfBundleSupported !== true) {
    throw new Error(
      'La extensión Eloísa abierta no incluye la descarga conjunta. Recarga la extensión y luego recarga HHR.'
    );
  }

  const result = await requestExtension('pdfBundle', { links }, 10 * 60_000, onProgress);
  if (!result.bridgeAvailable) {
    throw new Error('La extensión Eloísa dejó de responder. Recarga HHR y vuelve a intentarlo.');
  }
  const error = responseError(result, 'La extensión no pudo descargar los informes de Syslab.');
  if (error) throw new Error(error);
  if (result.response?.ok !== true) {
    throw new Error('Syslab no pudo preparar la descarga solicitada.');
  }
  const filename = typeof result.response.filename === 'string' ? result.response.filename : '';
  const reportCount = Number(result.response.reportCount);
  const pageCount = Number(result.response.pageCount);
  if (!filename || !Number.isInteger(reportCount) || !Number.isInteger(pageCount)) {
    return {
      filename: 'Examenes_Syslab_seleccionados.pdf',
      reportCount: links.length,
      pageCount: 0,
      legacyExtension: true,
    };
  }
  return { filename, reportCount, pageCount };
};

export const isSyslabExtensionLink = (link: string): boolean =>
  /^hhr-syslab-extension:\/\/batch\/[0-9a-f-]{36}\/exam\/\d+$/i.test(link);
