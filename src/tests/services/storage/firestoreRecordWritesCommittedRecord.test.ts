import { beforeEach, describe, expect, it, vi } from 'vitest';
const { firestoreWriteLoggerWarn, firestoreWriteLoggerError } = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
}));
const { mockDocToRecord, mockRecordTelemetry } = vi.hoisted(() => ({
  mockDocToRecord: vi.fn(),
  mockRecordTelemetry: vi.fn(),
}));
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());

    toDate = () => new Date('2026-03-14T12:34:56.789Z');
  }

  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn(),
    Timestamp: MockTimestamp,
    updateDoc: vi.fn(),
  };
});
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
// Retries once like the real helper, so a throw inside the closure would re-run the transaction.
vi.mock('@/utils/networkUtils', () => ({
  withRetry: vi.fn(
    async (
      operation: () => Promise<unknown>,
      options?: { shouldRetry?: (error: unknown) => boolean }
    ) => {
      try {
        return await operation();
      } catch (error) {
        if (options?.shouldRetry && !options.shouldRetry(error)) throw error;
        return operation();
      }
    }
  ),
}));
// Real flattening and sanitizing, so the payload has the shape the transaction commits.
vi.mock('@/services/storage/firestore/firestoreShared', async () => ({
  ...(await vi.importActual('@/services/storage/firestore/firestoreShared')),
  docToRecord: mockDocToRecord,
  getRecordDocRef: vi.fn((date: string) => ({ date })),
}));
vi.mock('@/services/storage/firestore/firestoreWriteSupport', () => ({
  ConcurrencyError: class ConcurrencyError extends Error {},
  asFirestoreUpdatePayload: vi.fn((payload: Record<string, unknown>) => payload),
  assertFirestoreConcurrency: vi.fn(),
  saveHistorySnapshot: vi.fn(),
  saveRecordAtomically: vi.fn(),
  updateRecordPartiallyAtomically: vi.fn(),
}));
vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreWriteLogger: { warn: firestoreWriteLoggerWarn, error: firestoreWriteLoggerError },
}));
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: mockRecordTelemetry,
}));
vi.mock('@/services/auth/authAccessResolution', () => ({
  resolveFirebaseUserRole: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { ready: Promise.resolve(), getCurrentUser: () => null },
}));
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { updateRecordPartiallyAtomically } from '@/services/storage/firestore/firestoreWriteSupport';
import { projectFirestoreUpdate } from '@/services/storage/firestore/firestoreUpdateProjection';

const DATE = '2026-03-14';
const BASE_VERSION = '2026-03-14T10:00:00.000Z';
const COMMITTED_AT = '2026-03-14T12:34:56.789Z';

// Synthetic committed base, including a legacy rayenSync key that docToRecord drops.
const remoteBase = {
  date: DATE,
  lastUpdated: BASE_VERSION,
  beds: { R1: { patientName: 'Paciente Sintético', isUPC: false } },
  rayenSync: { at: 'old-at', by: 'old-by', runId: 'run-old', legacyImportedAt: 'legacy' },
};

const { docToRecord } = await vi.importActual<
  typeof import('@/services/storage/firestore/firestoreShared')
>('@/services/storage/firestore/firestoreShared');

const atomicCommit = vi.mocked(updateRecordPartiallyAtomically);
const confirmedOptions = { requireAtomicCas: true, returnCommittedRecord: true } as const;

const expectFallbackReported = (reason: string, path?: string) =>
  expect(mockRecordTelemetry).toHaveBeenCalledWith(
    'firestore',
    'atomic_partial_committed_record',
    expect.anything(),
    expect.objectContaining({ code: 'firestore_committed_record_unavailable' }),
    { date: DATE, context: { reason, ...(path ? { path } : {}) } }
  );

describe('updateRecordPartial committed record receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocToRecord.mockImplementation(docToRecord);
    // The transaction resolves with the base its committing attempt read.
    atomicCommit.mockResolvedValue(remoteBase);
  });

  it('returns the committed record, projected onto the base and stamped with the payload time', async () => {
    const receipt = await updateRecordPartial(
      DATE,
      { rayenSync: { runId: 'run-new', at: 'new-at' } } as never,
      BASE_VERSION,
      { ...confirmedOptions, historyPolicy: 'skip' }
    );

    const payload = atomicCommit.mock.calls[0][1];
    expect(atomicCommit.mock.calls[0][5]).toEqual({ historyPolicy: 'skip' });
    expect(mockDocToRecord).toHaveBeenCalledWith(projectFirestoreUpdate(remoteBase, payload), DATE);
    expect(receipt).toEqual({
      recordState: {
        lastUpdated: COMMITTED_AT,
        meta: {},
        record: docToRecord(projectFirestoreUpdate(remoteBase, payload), DATE),
      },
    });
    expect(receipt).toMatchObject({
      recordState: {
        record: {
          lastUpdated: COMMITTED_AT,
          // The flattened rayenSync merges into the stored map: `by` survives from the base.
          rayenSync: { runId: 'run-new', at: 'new-at', by: 'old-by' },
          beds: { R1: { patientName: 'Paciente Sintético' } },
        },
      },
    });
    expect(mockRecordTelemetry).not.toHaveBeenCalled();
  });

  it('falls back without a receipt when docToRecord fails, never re-running the commit', async () => {
    mockDocToRecord.mockImplementationOnce(() => {
      throw new Error('migration failed');
    });

    await expect(
      updateRecordPartial(DATE, { discharges: [] } as never, BASE_VERSION, confirmedOptions)
    ).resolves.toBeUndefined();
    expect(atomicCommit).toHaveBeenCalledOnce();
    expectFallbackReported('conversion_failed');
  });

  it('falls back without a receipt when the payload cannot be projected', async () => {
    // Firestore would refuse a function too; the projection refuses it instead of guessing.
    await expect(
      updateRecordPartial(
        DATE,
        { handoffNovedadesDayShift: () => 'x' } as never,
        BASE_VERSION,
        confirmedOptions
      )
    ).resolves.toBeUndefined();
    expect(atomicCommit).toHaveBeenCalledOnce();
    expect(mockDocToRecord).not.toHaveBeenCalled();
    expectFallbackReported('unsupported_payload', 'handoffNovedadesDayShift');
  });

  it.each([
    ['still carries the base version', { lastUpdated: BASE_VERSION }],
    ['belongs to another day', { date: '2026-03-13' }],
  ])('falls back without a receipt when the converted record %s', async (_label, override) => {
    mockDocToRecord.mockImplementationOnce((data: Record<string, unknown>, docId: string) => ({
      ...docToRecord(data, docId),
      ...override,
    }));

    await expect(
      updateRecordPartial(DATE, { discharges: [] } as never, BASE_VERSION, confirmedOptions)
    ).resolves.toBeUndefined();
    expect(atomicCommit).toHaveBeenCalledOnce();
    expectFallbackReported('version_mismatch');
  });

  it('keeps plain local-first reclassification receipt-less', async () => {
    await expect(
      updateRecordPartial(DATE, { discharges: [], cma: [{ id: 'mov-1' }] } as never, BASE_VERSION, {
        requireAtomicCas: true,
      })
    ).resolves.toBeUndefined();
    expect(atomicCommit.mock.calls[0][5]).toEqual({ historyPolicy: undefined });
    expect(mockDocToRecord).not.toHaveBeenCalled();
    expect(mockRecordTelemetry).not.toHaveBeenCalled();
  });
});
