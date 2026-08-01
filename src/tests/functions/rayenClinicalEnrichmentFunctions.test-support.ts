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

export const digestPayload = (payload: ReturnType<typeof makePayload>): string => {
  const parsed = parseClinicalEnrichmentPayload(payload);
  return digestValue({
    date: parsed.date,
    patches: parsed.patches,
    checkpoints: parsed.checkpoints,
  });
};

export const makeContext = () => ({
  auth: { token: { email: 'nurse@example.com' } },
});

export const createClinicalAdminMock = (remoteData = makeClinicalRecord()) => {
  const set = vi.fn();
  const create = vi.fn();
  const get = vi.fn().mockResolvedValue({
    exists: Boolean(remoteData),
    data: () => remoteData,
  });
  const historyDoc = vi.fn((id: string) => ({ path: `history/${id}` }));
  const docRef = {
    path: 'dailyRecords/2026-07-28',
    collection: vi.fn(() => ({ doc: historyDoc })),
  };
  const telemetryAdd = vi.fn().mockResolvedValue({ id: 'telemetry-1' });
  const dailyRecords = { doc: vi.fn(() => docRef) };
  const telemetry = { add: telemetryAdd };
  const hospitalDoc = {
    collection: vi.fn((name: string) => (name === 'functionsTelemetry' ? telemetry : dailyRecords)),
  };
  const collection = vi.fn(() => ({ doc: vi.fn(() => hospitalDoc) }));
  const transaction = { create, get, set };
  const firestore = Object.assign(
    () => ({
      collection,
      runTransaction: (callback: (value: typeof transaction) => unknown) => callback(transaction),
    }),
    {
      Timestamp: {
        now: vi.fn(() => ({ seconds: 42, nanoseconds: 0 })),
      },
    }
  );

  return {
    firestore,
    get,
    create,
    set,
    historyDoc,
    docRef,
    telemetryAdd,
  };
};
