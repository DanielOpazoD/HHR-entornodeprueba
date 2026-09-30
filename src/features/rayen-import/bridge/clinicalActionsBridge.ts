import {
  decodeClinicalAntecedentDetail,
  type ClinicalAntecedentDetail,
} from './clinicalAntecedentDetail';
export type { ClinicalAntecedentDetail } from './clinicalAntecedentDetail';

export interface ClinicalAntecedentEntry {
  id: string;
  source: string;
  date: string;
  diagnosis: string;
  facility: string;
  type: string;
  windowEnd?: string;
}
export interface ClinicalActionResult {
  ok: boolean;
  opened?: boolean;
  error?: string;
  entries?: ClinicalAntecedentEntry[];
  warnings?: string[];
  unavailableSources?: Array<'Primaria' | 'Secundaria'>;
  windowStart?: string;
  windowEnd?: string;
  nextBeforeDate?: string | null;
  detail?: ClinicalAntecedentDetail;
}

export const requestClinicalAction = (
  encId: string,
  operation: 'prescription' | 'list' | 'detail' | 'attachment' | 'urgency',
  entryId?: string,
  signal?: AbortSignal,
  beforeDate?: string
): Promise<ClinicalActionResult> =>
  new Promise(resolve => {
    if (!/^\d+$/.test(encId) || signal?.aborted) {
      resolve({ ok: false, error: 'Consulta clínica cancelada o episodio inválido.' });
      return;
    }
    const reqId = `clinical-action-${crypto.randomUUID()}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- cleanup can run before timer assignment
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ClinicalActionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ ok: false, error: 'Consulta cancelada.' });
    const onMessage = (event: MessageEvent): void => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_RAYEN_CLINICAL_ACTION_RESULT' ||
        event.data.reqId !== reqId
      )
        return;
      const data = event.data;
      const entries = Array.isArray(data.entries)
        ? data.entries.filter(
            (row: unknown): row is ClinicalAntecedentEntry =>
              Boolean(row) &&
              typeof row === 'object' &&
              ['id', 'source', 'date', 'diagnosis', 'facility', 'type'].every(
                key => typeof (row as Record<string, unknown>)[key] === 'string'
              )
          )
        : undefined;
      const safeEntries = entries?.map((row: ClinicalAntecedentEntry) => ({
        ...row,
        windowEnd:
          typeof row.windowEnd === 'string' && /^\d{8}$/.test(row.windowEnd)
            ? row.windowEnd
            : undefined,
      }));
      const detail = decodeClinicalAntecedentDetail(data.detail);
      const invalidDetail = data.detail !== undefined && !detail;
      finish({
        ok: data.ok === true && !invalidDetail,
        opened: data.opened === true,
        error:
          typeof data.error === 'string'
            ? data.error
            : invalidDetail
              ? 'El detalle clínico tiene un formato inválido. Actualiza la extensión y reintenta.'
              : undefined,
        entries: safeEntries,
        detail,
        warnings: Array.isArray(data.warnings)
          ? data.warnings.filter((value: unknown) => typeof value === 'string')
          : undefined,
        unavailableSources: Array.isArray(data.unavailableSources)
          ? data.unavailableSources.filter(
              (value: unknown): value is 'Primaria' | 'Secundaria' =>
                value === 'Primaria' || value === 'Secundaria'
            )
          : undefined,
        windowStart:
          typeof data.windowStart === 'string' && /^\d{8}$/.test(data.windowStart)
            ? data.windowStart
            : undefined,
        windowEnd:
          typeof data.windowEnd === 'string' && /^\d{8}$/.test(data.windowEnd)
            ? data.windowEnd
            : undefined,
        nextBeforeDate:
          data.nextBeforeDate === null ||
          (typeof data.nextBeforeDate === 'string' && /^\d{8}$/.test(data.nextBeforeDate))
            ? data.nextBeforeDate
            : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: 'La extensión no respondió a la consulta clínica. Revisa tu conexión con Eloísa.',
        }),
      90000
    );
    try {
      window.postMessage(
        { type: 'HHR_RAYEN_CLINICAL_ACTION_REQUEST', reqId, encId, operation, entryId, beforeDate },
        window.location.origin
      );
    } catch {
      finish({ ok: false, error: 'No se pudo consultar la extensión Eloísa.' });
    }
  });
