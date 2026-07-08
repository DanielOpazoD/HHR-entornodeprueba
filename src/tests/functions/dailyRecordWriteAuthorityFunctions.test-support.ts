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
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');

export const makeRecord = (): {
  date: string;
  lastUpdated: string;
  beds: Record<string, Record<string, unknown>>;
  discharges: unknown[];
  transfers: unknown[];
  cma: unknown[];
} => ({
  date: '2026-05-13',
  lastUpdated: '2026-05-13T10:00:00.000Z',
  beds: {
    R1: {
      bedId: 'R1',
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      admissionDate: '2026-05-13',
      admissionTime: '08:00',
      clinicalEpisodeId: 'ep-uno',
      isBlocked: false,
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
});

export const makeContext = () => ({
  auth: {
    token: {
      email: 'doctor@example.com',
    },
  },
});

export const createAdminMock = ({
  remoteData,
}: {
  remoteData?: Record<string, unknown>;
} = {}) => {
  const set = vi.fn();
  const telemetryAdd = vi.fn().mockResolvedValue({ id: 'telemetry-1' });
  const collection = vi.fn();
  const historyDoc = { path: 'history-doc' };
  const historyCollection = { doc: vi.fn(() => historyDoc) };
  const docRef = {
    path: 'daily-record-doc',
    collection: vi.fn(() => historyCollection),
  };
  const dailyRecordsCollection = { doc: vi.fn(() => docRef) };
  const functionsTelemetryCollection = { add: telemetryAdd };
  const hospitalDoc = {
    collection: vi.fn((name: string) =>
      name === 'functionsTelemetry' ? functionsTelemetryCollection : dailyRecordsCollection
    ),
  };
  collection.mockReturnValue({ doc: vi.fn(() => hospitalDoc) });

  const transaction = {
    get: vi.fn().mockResolvedValue({
      exists: Boolean(remoteData),
      data: () => remoteData,
    }),
    set,
  };

  return {
    transaction,
    set,
    telemetryAdd,
    docRef,
    historyDoc,
    admin: {
      firestore: Object.assign(
        () => ({
          collection,
          runTransaction: (callback: (tx: typeof transaction) => unknown) => callback(transaction),
        }),
        {
          Timestamp: {
            now: vi.fn(() => ({ seconds: 10, nanoseconds: 0 })),
          },
        }
      ),
    },
  };
};
