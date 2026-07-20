/** Privacy-preserving bridge for official Eloisa hospitalization reports. */

export const RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE = 'HHR_RAYEN_EPICRISIS_DOWNLOAD_REQUEST';
export const RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE = 'HHR_RAYEN_EPICRISIS_DOWNLOAD_RESULT';

export interface RayenHospitalizationEpisode {
  encId: string;
  startDate: string;
  endDate?: string;
  active: boolean;
}

export type RayenHospitalizationDocumentType = 'epicrisis' | 'history';

export interface RayenHospitalizationReportResult {
  ok: boolean;
  episodes?: RayenHospitalizationEpisode[];
  opened?: boolean;
  error?: string;
}

interface RayenHospitalizationReportRequest {
  operation: 'list' | 'download';
  patientRun: string;
  clinicalEpisodeId?: string;
  censusDate?: string;
  documentType?: RayenHospitalizationDocumentType;
}

const normalizeRun = (value: string): string => value.toUpperCase().replace(/[^0-9K]/g, '');

const parseEpisode = (value: unknown): RayenHospitalizationEpisode | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const encId = typeof row.encId === 'string' ? row.encId : '';
  const startDate = typeof row.startDate === 'string' ? row.startDate : '';
  const endDate = typeof row.endDate === 'string' ? row.endDate : undefined;
  if (!/^\d+$/.test(encId) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  return { encId, startDate, endDate, active: row.active === true };
};

const requestHospitalizationReport = (
  request: RayenHospitalizationReportRequest,
  timeoutMs: number
): Promise<RayenHospitalizationReportResult> =>
  new Promise(resolve => {
    const patientRun = normalizeRun(request.patientRun);
    if (typeof window === 'undefined' || !/^[0-9]{6,8}[0-9K]$/.test(patientRun)) {
      resolve({ ok: false, error: 'El paciente no tiene un RUN válido para buscar informes.' });
      return;
    }

    const reqId = `hospitalization-report-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- cleanup reads the timer before its assignment below
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE || data.reqId !== reqId) {
        return;
      }
      cleanup();
      const rawEpisodes: unknown[] = Array.isArray(data.episodes) ? data.episodes : [];
      const episodes = Array.isArray(data.episodes)
        ? rawEpisodes
            .map(parseEpisode)
            .filter((episode): episode is RayenHospitalizationEpisode => episode !== null)
        : undefined;
      resolve({
        ok: data.ok === true,
        episodes,
        opened: data.opened === true,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        type: RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE,
        reqId,
        operation: request.operation,
        documentType: request.documentType,
        encId: request.clinicalEpisodeId?.trim() || undefined,
        patientRun,
        censusDate: request.censusDate,
      },
      window.location.origin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        error: 'La extensión Eloísa no respondió. Recárgala y vuelve a intentarlo.',
      });
    }, timeoutMs);
  });

export const requestRayenHospitalizationEpisodes = (
  request: Pick<RayenHospitalizationReportRequest, 'patientRun' | 'censusDate'>,
  timeoutMs = 15000
): Promise<RayenHospitalizationReportResult> =>
  requestHospitalizationReport({ ...request, operation: 'list' }, timeoutMs);

export const requestRayenHospitalizationDocument = (
  request: Omit<RayenHospitalizationReportRequest, 'operation'> & {
    documentType: RayenHospitalizationDocumentType;
  },
  timeoutMs = 30000
): Promise<RayenHospitalizationReportResult> =>
  requestHospitalizationReport({ ...request, operation: 'download' }, timeoutMs);
