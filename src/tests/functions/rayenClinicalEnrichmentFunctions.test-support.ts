import { createRequire } from 'node:module';
import { expect, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  region: (...regions: string[]) => ({
    https: {
      onCall: (handler: (data: unknown, context: unknown) => unknown) => ({
        run: handler,
        regions,
      }),
    },
  }),
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;
      details?: unknown;

      constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.code = code;
        this.details = details;
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

// Successful one-target fixtures may emit any numeric timing. Clinical fields,
// identifiers and arbitrary nested objects are not part of the telemetry contract.
export const expectClinicalTelemetryMetadata = (telemetry: unknown) => {
  expect(telemetry).toEqual({
    service: 'rayenClinicalEnrichment',
    operation: 'applyRayenClinicalEnrichmentBatch',
    hospitalId: 'hanga_roa',
    durationMs: expect.any(Number),
    attempt: 1,
    totalAttempts: 1,
    status: 'success',
    errorCode: null,
    timestamp: '2026-10-06T18:19:20.120Z',
    context: {
      date: '2026-07-28',
      mode: expect.stringMatching(/^(shadow|enforced)$/),
      dryRun: expect.any(Boolean),
      targetCount: 1,
      clinicalTargetCount: 1,
      checkpointTargetCount: 1,
      checkpointOnlyTargetCount: 0,
      fieldCount: 3,
      clinicalCribCount: 0,
      hasExpectedVersion: true,
      hasBaseRevision: true,
      fieldContractVersion: 2,
      versionGuardEnforced: expect.any(Boolean),
      targetScope: 'current',
      runCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
      mutationCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
      serverTimingsMs: {
        authorizationMs: expect.any(Number),
        transactionMs: expect.any(Number),
      },
      transactionTimingsMs: {
        callbackMs: expect.any(Number),
        documentReadMs: expect.any(Number),
        specialtyAuditMs: expect.any(Number),
        otherCallbackMs: expect.any(Number),
        outsideCallbackMs: expect.any(Number),
      },
      authorityStatus: expect.stringMatching(/^(ok|idempotent)$/),
      resultParity: expect.stringMatching(/^(matched|mismatch)$/),
      parityContractVersion: 2,
      mismatchTargetCount: expect.any(Number),
      mismatchFieldCount: expect.any(Number),
      mismatchDeviceFieldCount: expect.any(Number),
      mismatchScoreFieldCount: expect.any(Number),
      mismatchVitalFieldCount: expect.any(Number),
      mismatchCheckpointFieldCount: expect.any(Number),
      revision: expect.any(Number),
      policyRevision: 7,
      transactionAttempts: 1,
      transactionRetries: 0,
    },
  });
  expect(JSON.stringify(telemetry)).not.toMatch(
    /H2C1|episode-secret|Paciente reservado|11\.111|evaluationScores|vitalSigns|braden|run-1|mutation-1/
  );
};

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
