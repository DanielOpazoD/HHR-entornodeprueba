import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import {
  decodeClinicalAntecedentDetail,
  type ClinicalAntecedentDetail,
} from './clinicalAntecedentDetail';
export type { ClinicalAntecedentDetail } from './clinicalAntecedentDetail';
import { decodeClinicalDauAuth, type ClinicalDauAuth } from './clinicalDauAuth';

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
  auth?: ClinicalDauAuth;
}

const decodeEntries = (raw: unknown): ClinicalAntecedentEntry[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(
      (row: unknown): row is ClinicalAntecedentEntry =>
        Boolean(row) &&
        typeof row === 'object' &&
        ['id', 'source', 'date', 'diagnosis', 'facility', 'type'].every(
          key => typeof (row as Record<string, unknown>)[key] === 'string'
        )
    )
    .map(row => ({
      ...row,
      windowEnd:
        typeof row.windowEnd === 'string' && /^\d{8}$/.test(row.windowEnd)
          ? row.windowEnd
          : undefined,
    }));
};

export const requestClinicalAction = (
  encId: string,
  operation: 'prescription' | 'list' | 'detail' | 'attachment' | 'urgency' | 'dau',
  entryId?: string,
  signal?: AbortSignal,
  beforeDate?: string
): Promise<ClinicalActionResult> => {
  if (typeof window === 'undefined' || !/^\d+$/.test(encId) || signal?.aborted) {
    return Promise.resolve({
      ok: false,
      error: 'Consulta clínica cancelada o episodio inválido.',
    });
  }

  return requestViaBridgeChannel<ClinicalActionResult>({
    prefix: 'clinical-action',
    requestType: 'HHR_RAYEN_CLINICAL_ACTION_REQUEST',
    resultType: 'HHR_RAYEN_CLINICAL_ACTION_RESULT',
    payload: { encId, operation, entryId, beforeDate },
    timeoutMs: 90_000,
    signal,
    onAbort: () => ({ ok: false, error: 'Consulta cancelada.' }),
    onTimeout: () => ({
      ok: false,
      error: 'La extensión no respondió a la consulta clínica. Revisa tu conexión con Eloísa.',
    }),
    onDispatchError: () => ({
      ok: false,
      error: 'No se pudo consultar la extensión Eloísa.',
    }),
    mapResult: data => {
      const detail = decodeClinicalAntecedentDetail(data.detail);
      const invalidDetail = data.detail !== undefined && !detail;
      return {
        ok: data.ok === true && !invalidDetail,
        opened: data.opened === true,
        error:
          typeof data.error === 'string'
            ? data.error
            : invalidDetail
              ? 'El detalle clínico tiene un formato inválido. Actualiza la extensión y reintenta.'
              : undefined,
        entries: decodeEntries(data.entries),
        detail,
        auth: operation === 'dau' ? decodeClinicalDauAuth(data.auth) : undefined,
        warnings: Array.isArray(data.warnings)
          ? data.warnings.filter((value: unknown): value is string => typeof value === 'string')
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
      };
    },
  });
};
