/**
 * Direct full saves on split days (D3 and D9 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md),
 * through the real saveRecordToFirestore → saveRecordAtomically path with Firestore mocked:
 * restoring a version taken before the day was split keeps the live marker, meta and moved
 * fields; a create never carries a marker; unmarked days save exactly as before.
 * Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  txGet: vi.fn(),
  txSet: vi.fn(),
  getSnapshot: vi.fn(),
  getCurrent: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('firebase/firestore', async original => {
  class MockTimestamp {
    static now = () => new MockTimestamp();
    toDate = () => new Date('2026-11-02T12:00:00.000Z');
  }
  return {
    ...(await original<typeof import('firebase/firestore')>()),
    collection: (...args: unknown[]) => ({ kind: 'collection', args }),
    doc: (...args: unknown[]) => ({ kind: 'history', args }),
    runTransaction: mocks.runTransaction,
    Timestamp: MockTimestamp,
  };
});
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: (date: string) => ({ kind: 'day', path: `hospitals/h/dailyRecords/${date}` }),
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({}) },
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
  >()),
  assertDailyRecordClinicalAuthority: () => undefined,
  resolveAuthenticatedDailyRecordAuthorityMode: async () => null,
  shouldRouteDailyRecordSaveViaCallable: async () => false,
  tryShadowDailyRecordSaveViaCallable: async () => undefined,
}));
vi.mock('@/services/storage/firestore/dailyRecordConflictSnapshotService', () => ({
  getConflictVersionSnapshot: mocks.getSnapshot,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: mocks.getCurrent,
}));
vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictVersionRestored: mocks.audit,
}));
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: vi.fn(),
}));

import { restoreDailyRecordVersion } from '@/services/repositories/dailyRecordVersionRestoreController';
import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';

type Holder = Record<string, unknown>;

const DATE = '2026-11-02';
const LIVE_AT = `${DATE}T11:00:00.000Z`;
const marker = { version: 1, generation: 'gen_synthetic_a' };
const moved = (label: string) => ({
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: label } },
  },
  vitalSignsHistory: [
    { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, heartRate: 80, author: label },
  ],
});
const patient = (bedId: string, clinicalEpisodeId: string, extra: Holder = {}): Holder => ({
  bedId,
  patientName: `Paciente sintético ${clinicalEpisodeId}`,
  rut: bedId === 'R1' ? '11.111.111-1' : '22.222.222-2',
  clinicalEpisodeId,
  ...extra,
});
const day = (beds: Record<string, Holder>, extra: Holder = {}): DailyRecord =>
  ({
    date: DATE,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: LIVE_AT,
    nurses: ['', ''],
    activeExtraBeds: [],
    ...extra,
  }) as unknown as DailyRecord;

// Live split day: ep_a lives in its document, ep_b is not split yet (embedded copy only).
const liveSplit = () =>
  day(
    { R1: patient('R1', 'ep_a'), R2: patient('R2', 'ep_b', moved('live-b')) },
    { clinicalDerivedLayout: marker, meta: { revision: 8, lastMutationId: 'server-mutation' } }
  );
// Version captured before the split, at a lower revision, still embedding every moved field.
const preSplitVersion = () =>
  day(
    {
      R1: patient('R1', 'ep_a', { ...moved('old-a'), handoffNote: 'versión elegida' }),
      R2: patient('R2', 'ep_b', moved('old-b')),
    },
    { lastUpdated: `${DATE}T09:00:00.000Z`, meta: { revision: 2 } }
  );

const committedDay = () => {
  const call = mocks.txSet.mock.calls.find(([ref]) => (ref as Holder).kind === 'day');
  return call?.[1] as Holder & { beds: Record<string, Holder> };
};

const restore = async (live: DailyRecord, version: DailyRecord) => {
  mocks.getSnapshot.mockResolvedValue({
    id: 'cid__incoming',
    origin: 'incoming_premerge',
    record: version,
  });
  mocks.getCurrent.mockResolvedValue(live);
  mocks.txGet.mockResolvedValue({ exists: () => true, data: () => live });
  return restoreDailyRecordVersion(DATE, 'cid__incoming');
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.audit.mockResolvedValue(undefined);
  mocks.runTransaction.mockImplementation(async (_db, callback) =>
    callback({ get: mocks.txGet, set: mocks.txSet })
  );
});

describe('version restore over a split day', () => {
  it('keeps the live marker, meta and moved fields of a version taken before the split', async () => {
    await expect(restore(liveSplit(), preSplitVersion())).resolves.toEqual({ status: 'restored' });

    const written = committedDay();
    expect(written.clinicalDerivedLayout).toEqual(marker);
    // Never lowers the revision (the update rule denies it on a marked day).
    expect(written.meta).toEqual({ revision: 8, lastMutationId: 'server-mutation' });
    expect('vitalSignsHistory' in written.beds.R1).toBe(false);
    expect('clinicalSyncCheckpoint' in written.beds.R1).toBe(false);
    expect(written.beds.R2).toMatchObject(moved('live-b'));
    // Everything else is the chosen version, and the live day was copied to history first.
    expect(written.beds.R1.handoffNote).toBe('versión elegida');
    expect(mocks.txSet.mock.calls.some(([ref]) => (ref as Holder).kind === 'history')).toBe(true);
  });

  it('restores an unmarked day exactly as before', async () => {
    const live = day({ R1: patient('R1', 'ep_a', moved('live-a')) }, { meta: { revision: 4 } });
    await restore(live, preSplitVersion());

    const written = committedDay();
    expect('clinicalDerivedLayout' in written).toBe(false);
    expect(written.meta).toEqual({ revision: 2 });
    expect(written.beds.R1).toMatchObject({ ...moved('old-a'), handoffNote: 'versión elegida' });
  });
});

describe('direct full save', () => {
  it('never creates a day with a marker, even from a marked local copy', async () => {
    mocks.txGet.mockResolvedValue({ exists: () => false });

    const receipt = await saveRecordToFirestore(liveSplit(), undefined, {
      returnCommittedRecord: true,
    });

    expect('clinicalDerivedLayout' in committedDay()).toBe(false);
    expect(committedDay().beds.R2).toMatchObject(moved('live-b'));
    const record = receipt?.recordState?.record;
    expect(record).toBeDefined();
    expect('clinicalDerivedLayout' in (record as object)).toBe(false);
  });

  it('returns the day as committed on a split day, not the local copy', async () => {
    mocks.txGet.mockResolvedValue({ exists: () => true, data: () => liveSplit() });

    const receipt = await saveRecordToFirestore(preSplitVersion(), LIVE_AT, {
      returnCommittedRecord: true,
    });

    const record = receipt?.recordState?.record as unknown as Holder & {
      beds: Record<string, Holder>;
    };
    expect(record).toMatchObject({ clinicalDerivedLayout: marker, meta: { revision: 8 } });
    expect('vitalSignsHistory' in record.beds.R1).toBe(false);
    expect(record.beds.R2).toMatchObject(moved('live-b'));
    expect(record.lastUpdated).toBe(receipt?.recordState?.lastUpdated);
  });
});
