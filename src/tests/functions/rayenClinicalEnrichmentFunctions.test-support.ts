import { createRequire } from 'node:module';
import { vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
export const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const {
  buildLegacyClinicalEnrichmentDigest,
  clinicalEnrichmentMatches,
  digestValue,
  parseClinicalEnrichmentPayload,
} = require('../../../functions/lib/rayenClinicalEnrichmentPolicy.js');

export {
  buildLegacyClinicalEnrichmentDigest,
  clinicalEnrichmentMatches,
  parseClinicalEnrichmentPayload,
};

export const makeClinicalRecord = () => ({
  date: '2026-07-28',
  lastUpdated: '2026-07-28T10:00:00.000Z',
  beds: {
    H2C1: {
      bedId: 'H2C1',
      patientName: 'Paciente reservado',
      rut: '11.111.111-1',
      admissionDate: '2026-07-27',
      clinicalEpisodeId: 'episode-secret-1',
      devices: [],
      clinicalCrib: {
        bedId: 'H2C1-CUNA',
        patientName: 'RN reservado',
        clinicalEpisodeId: 'episode-crib-secret',
      },
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  meta: { revision: 4 },
});

export const makePayload = () => ({
  date: '2026-07-28',
  authorityDate: '2026-07-28',
  runId: 'run-1',
  mutationId: 'mutation-1',
  expectedLastUpdated: '2026-07-28T10:00:00.000Z',
  baseRevision: 4,
  fieldContractVersion: 2,
  mode: 'enforced',
  patches: [
    {
      bedId: 'H2C1',
      clinicalEpisodeId: 'episode-secret-1',
      fields: {
        evaluationScores: { braden: { total: 17 } },
        vitalSigns: { systolic: 120 },
        clinicalSyncCheckpoint: { version: 1, sources: {} },
      },
    },
  ],
});

export const digestPayload = (payload: unknown): string => {
  const parsed = parseClinicalEnrichmentPayload(payload);
  return digestValue({
    date: parsed.date,
    authorityDate: parsed.authorityDate,
    patches: parsed.patches,
    checkpoints: parsed.checkpoints,
  });
};

export const makeContext = () => ({
  auth: { token: { email: 'nurse@example.com' } },
});

interface ClinicalAdminMockOptions {
  clinicalBatchMode?: 'shadow' | 'enforced';
  importMode?: 'preview' | 'auto';
  policySchemaVersion?: 1 | 2;
  policyExists?: boolean;
  policyRevision?: number;
  runPolicy?: 'matching' | 'missing';
  authorityDate?: string;
  authorityRemoteData?: ReturnType<typeof makeClinicalRecord>;
  historySnapshotExists?: boolean;
  runStatus?: 'applied' | 'complete' | 'partial' | 'failed';
  runSourceDate?: string | null;
}

export const createClinicalAdminMock = (
  remoteData = makeClinicalRecord(),
  {
    clinicalBatchMode = 'enforced',
    importMode = 'preview',
    policySchemaVersion = 2,
    policyExists = true,
    policyRevision = 7,
    runPolicy = 'matching',
    authorityDate = remoteData?.date ?? '2026-07-28',
    authorityRemoteData,
    historySnapshotExists = false,
    runStatus = 'applied',
    runSourceDate = authorityDate,
  }: ClinicalAdminMockOptions = {}
) => {
  const runEvent =
    runPolicy === 'matching'
      ? {
          id: 'run-1',
          ...(runSourceDate ? { sourceDate: runSourceDate } : {}),
          startedAt: '2026-07-28T09:59:00.000Z',
          by: 'nurse@example.com',
          status: runStatus,
          policy: {
            mode: importMode,
            revision: policyRevision,
            ...(policySchemaVersion === 2 ? { clinicalBatchMode } : {}),
          },
        }
      : null;
  const authoritySource = authorityRemoteData ?? remoteData;
  const authorizedRemoteData =
    authoritySource && runEvent
      ? {
          ...authoritySource,
          rayenSyncHistory: [
            runEvent,
            ...(
              (authoritySource as { rayenSyncHistory?: Array<{ id?: string }> }).rayenSyncHistory ??
              []
            ).filter(event => event.id !== 'run-1'),
          ],
        }
      : authoritySource;
  const globalPolicy = {
    schemaVersion: policySchemaVersion,
    mode: importMode,
    revision: policyRevision,
    ...(policySchemaVersion === 2 ? { clinicalBatchMode } : {}),
  };
  const set = vi.fn();
  const createdHistoryPaths = new Set<string>();
  const create = vi.fn((reference: { path?: string }) => {
    if (reference.path) createdHistoryPaths.add(reference.path);
  });
  const recordsByDate = new Map<string, unknown>([[remoteData?.date ?? '2026-07-28', remoteData]]);
  recordsByDate.set(authorityDate, authorizedRemoteData);
  const recordGet = vi.fn(async (reference: { id?: string }) => {
    const record = recordsByDate.get(reference.id ?? '');
    return {
      exists: Boolean(record),
      data: () => record,
    };
  });
  const policyGet = vi.fn().mockResolvedValue({
    exists: policyExists,
    data: () => globalPolicy,
  });
  const historyDoc = vi.fn((id: string) => ({ path: `history/${id}` }));
  const recordRefs = new Map<
    string,
    { id: string; path: string; collection: ReturnType<typeof vi.fn> }
  >();
  const getRecordRef = (date: string) => {
    const existing = recordRefs.get(date);
    if (existing) return existing;
    const reference = {
      id: date,
      path: `dailyRecords/${date}`,
      collection: vi.fn(() => ({ doc: historyDoc })),
    };
    recordRefs.set(date, reference);
    return reference;
  };
  const docRef = getRecordRef(remoteData?.date ?? '2026-07-28');
  const policyRef = { path: 'settings/rayenImportPolicy' };
  const telemetryAdd = vi.fn().mockResolvedValue({ id: 'telemetry-1' });
  const dailyRecords = { doc: vi.fn((date: string) => getRecordRef(date)) };
  const settings = { doc: vi.fn(() => policyRef) };
  const telemetry = { add: telemetryAdd };
  const hospitalDoc = {
    collection: vi.fn((name: string) => {
      if (name === 'functionsTelemetry') return telemetry;
      if (name === 'settings') return settings;
      return dailyRecords;
    }),
  };
  const collection = vi.fn(() => ({ doc: vi.fn(() => hospitalDoc) }));
  const get = vi.fn((reference: unknown) => {
    if (reference === policyRef) return policyGet();
    const path = String((reference as { path?: string })?.path ?? '');
    if (path.startsWith('history/')) {
      return Promise.resolve({
        exists: historySnapshotExists || createdHistoryPaths.has(path),
        data: () => undefined,
      });
    }
    return recordGet(reference as { id?: string });
  });
  const transaction = { create, get, set };
  const runTransaction = vi.fn((callback: (value: typeof transaction) => unknown) =>
    callback(transaction)
  );
  const firestore = Object.assign(
    () => ({
      collection,
      runTransaction,
    }),
    {
      Timestamp: {
        now: vi.fn(() => ({ seconds: 42, nanoseconds: 0 })),
      },
    }
  );

  return {
    firestore,
    authorizedRemoteData,
    runEvent,
    get,
    policyGet,
    recordGet,
    create,
    set,
    historyDoc,
    runTransaction,
    transaction,
    docRef,
    getRecordRef,
    recordsByDate,
    policyRef,
    telemetryAdd,
  };
};
