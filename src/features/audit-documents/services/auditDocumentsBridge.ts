/**
 * Page side of the audit download. The extension reads Eloísa with its own session and saves the
 * ZIP itself; this page only sends the RUT list and receives counts per RUT.
 */
import type { AuditDocumentType, AuditPatientRequest } from '../domain/auditDocumentsRequest';

export const AUDIT_DOCUMENTS_REQUEST_TYPE = 'HHR_RAYEN_AUDIT_DOCUMENTS_REQUEST';
export const AUDIT_DOCUMENTS_CANCEL_TYPE = 'HHR_RAYEN_AUDIT_DOCUMENTS_CANCEL';
export const AUDIT_DOCUMENTS_PROGRESS_TYPE = 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS';
export const AUDIT_DOCUMENTS_RESULT_TYPE = 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT';
export const AUDIT_DOCUMENTS_MINIMUM_EXTENSION_VERSION = '0.48.65';

/** The extension acknowledges at once; silence means it is missing or older than this feature. */
export const AUDIT_DOCUMENTS_ACK_TIMEOUT_MS = 4_000;
/** Every Eloísa read has a 45 s limit and each one reports progress, so this is ample. */
export const AUDIT_DOCUMENTS_IDLE_TIMEOUT_MS = 120_000;

export type AuditDocumentsPhase = 'accepted' | 'listing' | 'downloading' | 'retrying' | 'packing';

export interface AuditDocumentsProgress {
  phase: AuditDocumentsPhase;
  done: number;
  total: number;
}

export interface AuditDocumentsPatientSummary {
  run: string;
  name: string;
  error?: string;
  hospitalizations: number;
  /** Hospitalizations Eloísa listed without a readable date or a RUT to verify. */
  unverified: number;
  downloaded: number;
  /** Histories saved without a day Eloísa cannot generate (the day summer time began). */
  incomplete: number;
  failed: number;
}

export interface AuditDocumentsResult {
  ok: boolean;
  cancelled?: boolean;
  filename?: string;
  documentCount?: number;
  failedCount?: number;
  summary?: AuditDocumentsPatientSummary[];
  error?: string;
}

const PHASES: readonly AuditDocumentsPhase[] = [
  'accepted',
  'listing',
  'downloading',
  'retrying',
  'packing',
];

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

const parseSummary = (value: unknown): AuditDocumentsPatientSummary[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.run !== 'string' || !row.run) return [];
    return [
      {
        run: row.run,
        name: typeof row.name === 'string' ? row.name : '',
        ...(typeof row.error === 'string' && row.error ? { error: row.error } : {}),
        hospitalizations: count(row.hospitalizations),
        unverified: count(row.unverified),
        downloaded: count(row.downloaded),
        incomplete: count(row.incomplete),
        failed: count(row.failed),
      },
    ];
  });
};

export interface AuditDocumentsRun {
  result: Promise<AuditDocumentsResult>;
  cancel: () => void;
}

export const requestAuditDocuments = ({
  patients,
  documentTypes,
  onProgress,
}: {
  patients: AuditPatientRequest[];
  documentTypes: AuditDocumentType[];
  onProgress: (progress: AuditDocumentsProgress) => void;
}): AuditDocumentsRun => {
  const reqId = `audit-documents-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  let settle: (result: AuditDocumentsResult) => void = () => undefined;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = new Promise<AuditDocumentsResult>(resolve => {
    settle = value => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };
  });

  const waitFor = (ms: number, error: string) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      // Giving up here must also stop the extension, or it keeps the single download slot busy.
      window.postMessage({ type: AUDIT_DOCUMENTS_CANCEL_TYPE, reqId }, window.location.origin);
      settle({ ok: false, error });
    }, ms);
  };

  function onMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.reqId !== reqId) return;
    if (data.type === AUDIT_DOCUMENTS_PROGRESS_TYPE) {
      // Any sign of life counts, even a phase from a newer extension this page does not name yet.
      waitFor(
        AUDIT_DOCUMENTS_IDLE_TIMEOUT_MS,
        'La extensión Eloísa dejó de responder. Revisa que Ficha Médico siga abierta y vuelve a intentarlo.'
      );
      const phase = PHASES.find(candidate => candidate === data.phase);
      if (phase) onProgress({ phase, done: count(data.done), total: count(data.total) });
      return;
    }
    if (data.type !== AUDIT_DOCUMENTS_RESULT_TYPE) return;
    if (data.cancelled === true) {
      settle({ ok: false, cancelled: true, error: 'Descarga cancelada.' });
      return;
    }
    settle({
      ok: data.ok === true,
      filename: typeof data.filename === 'string' ? data.filename : undefined,
      documentCount: count(data.documentCount),
      failedCount: count(data.failedCount),
      summary: parseSummary(data.summary),
      error: typeof data.error === 'string' ? data.error : undefined,
    });
  }

  window.addEventListener('message', onMessage);
  waitFor(
    AUDIT_DOCUMENTS_ACK_TIMEOUT_MS,
    'La extensión Eloísa no respondió. Esta función necesita la versión ' +
      `${AUDIT_DOCUMENTS_MINIMUM_EXTENSION_VERSION} o superior: actualízala y recarga esta página.`
  );
  window.postMessage(
    { type: AUDIT_DOCUMENTS_REQUEST_TYPE, reqId, patients, documentTypes },
    window.location.origin
  );

  return {
    result,
    cancel: () => {
      if (settled) return;
      window.postMessage({ type: AUDIT_DOCUMENTS_CANCEL_TYPE, reqId }, window.location.origin);
      settle({ ok: false, cancelled: true, error: 'Descarga cancelada.' });
    },
  };
};
