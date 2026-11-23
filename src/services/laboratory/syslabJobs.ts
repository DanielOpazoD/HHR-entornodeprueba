import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { onSessionChange, sessionEpochGuard } from '@/services/session/sessionStorageTransition';
import type {
  LabResultRow,
  SyslabDetailsResponse,
  SyslabExamItem,
} from '@/types/domain/labExamTypes';
import type { SyslabDetailsOptions } from './syslabDetailsBatch';
import { assertSyslabDetailsMatch } from './syslabDetailsBatch';

import type { CensusLabPatient, CensusLabDateRange } from '@/shared/contracts/censusLaboratory';
export type { CensusLabPatient, CensusLabDateRange } from '@/shared/contracts/censusLaboratory';

export interface CensusLabInput {
  patients: CensusLabPatient[];
  censusDate: string;
  dateRange?: CensusLabDateRange;
  force?: boolean;
  offset?: number;
  onlyUnread?: boolean;
}
export interface LaboratoryJob {
  id: string;
  kind: 'details' | 'census';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  createdAt: string;
  finishedAt?: string;
  completed: number;
  total: number;
  errors: string[];
  patients: {
    subjectKey: string;
    status: 'ready' | 'failed';
    pending?: number;
    reports?: number;
    checkedAt?: string;
  }[];
  reportProgress?: { subjectKey: string; completed: number; total: number };
  data?: SyslabDetailsResponse['data'];
  omittedUrls?: string[];
}
export interface CensusLabEntry {
  id: string;
  subjectKey: string;
  exam: SyslabExamItem;
  findings: LabResultRow[];
  revision: string;
  detectedAt: string;
  reviewedAt: string | null;
}
export interface CensusLabState {
  entries: CensusLabEntry[];
  unread: number;
  jobs: LaboratoryJob[];
  nextOffset: number | null;
}

const waitWhileSessionCurrent = (ms: number, isCurrent: () => boolean): Promise<void> =>
  new Promise(resolve => {
    if (!isCurrent()) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = onSessionChange(finish);
    const timer = setTimeout(finish, ms);
  });

const parseSyslabJobJson = async <T>(
  response: Response
): Promise<T & { success?: boolean; error?: string }> => {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error('No se pudo consultar la cola del Mac mini.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('La cola del Mac mini devolvió una respuesta no válida.');
  }
  return raw as T & { success?: boolean; error?: string };
};

/** Short authenticated requests only. The Mac mini owns long-running work, not a Netlify invocation. */
export const requestSyslabJob = async <T>(
  action: string,
  body?: unknown,
  id?: string,
  isCurrent: () => boolean = () => true,
  offset?: number,
  rateLimitAttempt = 0
): Promise<T> => {
  const isSessionShown = sessionEpochGuard();
  const isRequestCurrent = () => isCurrent() && isSessionShown();
  const assertCurrent = () => {
    if (!isRequestCurrent()) throw new Error('Consulta cancelada.');
  };
  assertCurrent();
  const headers = await resolveCurrentUserAuthHeaders();
  assertCurrent();
  if (!headers.Authorization) throw new Error('Inicia sesión en HHR para consultar el Mac mini.');
  const controller = new AbortController();
  const unsubscribeSession = onSessionChange(() => controller.abort());
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const query = new URLSearchParams({
      action,
      ...(id ? { id } : {}),
      ...(offset !== undefined ? { offset: String(offset) } : {}),
    });
    const response = await fetch(`/.netlify/functions/syslab-proxy?${query}`, {
      method: action === 'job-status' || action === 'job-result' ? 'GET' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    assertCurrent();
    const progressRead =
      action === 'job-status' || action === 'job-result' || action === 'census-state';
    if (response.status === 429 && progressRead && rateLimitAttempt < 3) {
      clearTimeout(timeout);
      unsubscribeSession();
      const requestedSeconds = Number(response.headers.get('Retry-After'));
      const seconds =
        Number.isFinite(requestedSeconds) && requestedSeconds > 0
          ? Math.min(requestedSeconds, 300)
          : 60;
      await waitWhileSessionCurrent(seconds * 1000, isRequestCurrent);
      assertCurrent();
      return requestSyslabJob<T>(action, body, id, isRequestCurrent, offset, rateLimitAttempt + 1);
    }
    const value = await parseSyslabJobJson<T>(response);
    assertCurrent();
    if (!response.ok || value.success !== true) {
      throw new Error(value.error || 'No se pudo consultar la cola del Mac mini.');
    }
    return value;
  } catch (error) {
    assertCurrent();
    throw error;
  } finally {
    clearTimeout(timeout);
    unsubscribeSession();
  }
};

const censusPayload = (input: CensusLabInput) => ({
  ...input,
  patients: input.patients.map(({ rutBody, episodeId, admissionDate }) => ({
    rutBody,
    episodeId,
    admissionDate,
  })),
});

export const readCensusLaboratoryState = (input: CensusLabInput, isCurrent?: () => boolean) =>
  requestSyslabJob<CensusLabState>('census-state', censusPayload(input), undefined, isCurrent);

export const createCensusLaboratoryJob = (input: CensusLabInput, isCurrent?: () => boolean) =>
  requestSyslabJob<{ job: LaboratoryJob }>(
    'job-create',
    { kind: 'census', ...censusPayload(input) },
    undefined,
    isCurrent
  );

export const changeLaboratoryJob = (
  id: string,
  action: 'cancel' | 'retry',
  isCurrent?: () => boolean
) => requestSyslabJob<{ job: LaboratoryJob }>(`job-${action}`, {}, id, isCurrent);

export const reviewCensusLaboratoryEntry = (entry: CensusLabEntry, isCurrent?: () => boolean) =>
  requestSyslabJob(
    'census-review',
    { id: entry.id, revision: entry.revision },
    undefined,
    isCurrent
  );

export const readRemoteSyslabDetailsJob = async (
  links: string[],
  options: SyslabDetailsOptions
): Promise<SyslabDetailsResponse> => {
  const isSessionShown = sessionEpochGuard();
  const isCurrent = () => isSessionShown() && (!options.isCurrent || options.isCurrent());
  const selected = [...new Set(links)];
  const requestedUrl = (index: number): string => {
    const link = selected[index];
    if (typeof link !== 'string') throw new Error('Índice de informe no válido.');
    return link;
  };
  const created = await requestSyslabJob<{ job: LaboratoryJob }>(
    'job-create',
    { kind: 'details', links: selected },
    undefined,
    isCurrent
  );
  let job = created.job;
  while (isCurrent()) {
    if (
      !job ||
      !Number.isInteger(job.completed) ||
      !Number.isInteger(job.total) ||
      job.total !== selected.length
    ) {
      throw new Error('La cola devolvió un progreso no válido.');
    }
    options.onProgress?.({
      completed: job.completed,
      total: job.total,
      ...(job.status === 'queued' || job.status === 'running' ? { status: job.status } : {}),
    });
    if (job.status === 'completed') {
      const response: SyslabDetailsResponse = { success: true, data: [], omittedUrls: [] };
      let offset: number | null = 0;
      do {
        const page: {
          data: { index: number; findings: LabResultRow[] }[];
          omittedIndices: number[];
          nextOffset: number | null;
        } = await requestSyslabJob('job-result', undefined, job.id, isCurrent, offset);
        const indexes = [...page.data.map(detail => detail.index), ...page.omittedIndices];
        if (
          indexes.some(index => !Number.isInteger(index) || index < 0 || index >= selected.length)
        )
          throw new Error('Índice de informe no válido.');
        response.data.push(
          ...page.data.map(detail => ({
            url: requestedUrl(detail.index),
            findings: detail.findings,
          }))
        );
        response.omittedUrls!.push(...page.omittedIndices.map(requestedUrl));
        if (
          page.nextOffset !== null &&
          (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset)
        )
          throw new Error('Página de resultados no válida.');
        offset = page.nextOffset;
      } while (offset !== null);
      assertSyslabDetailsMatch(selected, response);
      return response;
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new Error(
        'No se completó la lectura de informes. Vuelve a intentar; el Mac mini conserva lo leído.'
      );
    }
    await waitWhileSessionCurrent(5_000, isCurrent);
    if (!isCurrent()) break;
    const response = await requestSyslabJob<{ job: LaboratoryJob }>(
      'job-status',
      undefined,
      job.id,
      isCurrent
    );
    job = response.job;
  }
  throw new Error('Consulta cancelada.');
};
