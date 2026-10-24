import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(),
}));
const callable = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({ id: 'synthetic-doc' })),
  collection: vi.fn(() => ({ id: 'synthetic-collection' })),
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
  writeBatch: vi.fn(() => ({ set: firestore.batchSet, commit: firestore.batchCommit })),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: vi.fn(async () => ({})) },
}));

import { invokeAuthority } from '@/services/storage/firestore/dailyRecordAuthorityTransport';
import {
  getConflictVersionSnapshot,
  saveConflictVersionSnapshots,
} from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
import { parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  IDENTITY_REVIEW_DATE as DATE,
  storedDay,
  storedDayWithPlantedReviews,
} from '@/tests/fixtures/identityReviewDayFixture';

const runtime = { getDb: () => ({}) as Firestore, ready: Promise.resolve() };

beforeEach(() => vi.clearAllMocks());

describe('stored identity reviews at the other storage boundaries', () => {
  it('drops every review from an authority answer', async () => {
    callable.mockResolvedValue({
      data: { success: true, recordState: { record: storedDayWithPlantedReviews() } },
    });

    const answer = await invokeAuthority('patch', { date: DATE, mode: 'enforced' } as never);

    expect(JSON.stringify(answer)).not.toContain('identityReview');
    expect(answer.recordState?.record.discharges[0].originalData?.patientName).toBe('PACIENTE UNO');
  });

  it('drops every review from a legacy Firebase day', () => {
    const record = parseDailyRecordWithDefaults(storedDayWithPlantedReviews(), DATE);

    expect(JSON.stringify(record)).not.toContain('identityReview');
    expect(record.transfers[0].originalData?.clinicalCrib?.patientName).toBe('RN SINTETICO');
  });

  it('drops every review from a conflict version read for a restore', async () => {
    firestore.getDoc.mockResolvedValue({
      id: 'conflict__remote_premerge',
      exists: () => true,
      data: () => ({
        origin: 'remote_premerge',
        expireAt: { toMillis: () => Date.now() + 60_000 },
        record: storedDayWithPlantedReviews(),
      }),
    });

    const snapshot = await getConflictVersionSnapshot(DATE, 'conflict__remote_premerge', runtime);

    expect(snapshot?.record.cma[0].originalData?.rut).toBe('FAKE-PASSPORT-R1');
    expect(JSON.stringify(snapshot)).not.toContain('identityReview');
  });

  it('never archives a conflict version that holds a bed under identity review', async () => {
    const reviewed: DailyRecord = docToRecord(storedDay(), DATE);

    const result = await saveConflictVersionSnapshots(
      DATE,
      'synthetic-conflict',
      { remote: reviewed, incoming: reviewed },
      runtime
    );

    expect(result.status).toBe('failed');
    expect(firestore.batchSet).not.toHaveBeenCalled();
    expect(firestore.batchCommit).not.toHaveBeenCalled();
  });

  it('still archives a readable conflict version', async () => {
    const readable = docToRecord(storedDay({ documentType: 'Pasaporte' }), DATE);

    const result = await saveConflictVersionSnapshots(
      DATE,
      'synthetic-conflict',
      { remote: readable, incoming: readable },
      runtime
    );

    expect(result.status).toBe('saved');
    expect(firestore.batchCommit).toHaveBeenCalledOnce();
  });
});
