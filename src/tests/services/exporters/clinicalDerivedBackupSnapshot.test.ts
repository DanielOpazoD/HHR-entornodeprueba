import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import { DataFactory } from '@/tests/factories/DataFactory';
import { reading } from './clinicalDerivedBackupRestore.test-support';
import {
  buildClinicalDerivedBackupSection,
  describeIncompleteClinicalDerivedBackup,
} from '@/services/exporters/clinicalDerivedBackupSection';
import { restoreClinicalDerivedBackupDay } from '@/services/exporters/clinicalDerivedBackupRestore';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((parent: unknown, name: string) => ({ kind: 'collection', parent, name })),
  doc: vi.fn((parent: unknown, id: string) => ({ kind: 'doc', parent, id })),
  getDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: vi.fn((date: string) => ({ kind: 'recordDocRef', date })),
  docToRecord: function normalizedRecordFixtureToDailyRecord(
    data: Record<string, unknown>,
    date: string
  ) {
    return { ...data, date };
  },
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({ kind: 'db' }) },
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_snapshot_1';
const NEXT_GENERATION = 'gen_synthetic_snapshot_2';
const EPISODE = 'ep_synthetic_snapshot_1';

const day = (revision = 4, generation = GENERATION) => ({
  ...DataFactory.createMockDailyRecord(DATE, {
    lastUpdated: `${DATE}T12:00:00.000Z`,
    clinicalDerivedLayout: { version: 1, generation },
    beds: {
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente Sintético',
        clinicalEpisodeId: EPISODE,
      }),
    },
  }),
  meta: { revision },
});

const episodeDoc = (
  overrides: Partial<ClinicalDerivedEpisodeDoc> = {}
): ClinicalDerivedEpisodeDoc => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId: EPISODE,
  layoutGeneration: GENERATION,
  target: 'bed',
  bedId: 'R2',
  dayRevision: 4,
  vitalSignsHistory: [reading(73)],
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: 'synthetic-watermark', packedFacts: ['fact|hash|order'] } },
  },
  ...overrides,
});

const daySnapshot = (record: DailyRecord | undefined = day(), hasPendingWrites = false) => ({
  id: DATE,
  exists: () => record !== undefined,
  data: () => record,
  metadata: { fromCache: false, hasPendingWrites },
});

const querySnapshot = (docs: readonly ClinicalDerivedEpisodeDoc[]) => ({
  docs: docs.map(data => ({ id: data.clinicalEpisodeId, data: () => data })),
  metadata: { fromCache: false, hasPendingWrites: false },
});

const roundTrip = async (record: DailyRecord) => {
  const before = JSON.stringify(record);
  const section = await buildClinicalDerivedBackupSection([record]);
  const serialized: unknown = JSON.parse(JSON.stringify(section));
  const restored = restoreClinicalDerivedBackupDay(record, serialized);
  expect(JSON.stringify(record)).toBe(before);
  return { section, serialized, restored };
};

const expectPartialWithDocs = async (
  record: DailyRecord,
  docs: readonly ClinicalDerivedEpisodeDoc[]
) => {
  const { section, serialized, restored } = await roundTrip(record);
  expect(serialized).toMatchObject({ [DATE]: { layoutGeneration: GENERATION, docs } });
  expect(section?.[DATE].status).toBe('unavailable');
  const warning = describeIncompleteClinicalDerivedBackup(section);
  expect(warning).toMatchObject({
    code: 'clinical_derived_backup_incomplete',
    severity: 'warning',
  });
  expect(warning?.userSafeMessage).toContain(DATE);
  expect(restored.kind).toBe('incomplete');
};

describe('clinicalDerived backup snapshot through the real SDK readers (D10, D14, SAVE-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDoc.mockReset();
    firestore.getDocs.mockReset();
    firestore.getDocFromServer.mockReset().mockResolvedValue(daySnapshot());
    firestore.getDocsFromServer.mockReset().mockResolvedValue(querySnapshot([episodeDoc()]));
  });

  it('control: stable unique episode round-trips both exact moved fields without a warning', async () => {
    const doc = episodeDoc();
    expect(ClinicalDerivedEpisodeDocSchema.safeParse(doc).success).toBe(true);

    const { section, serialized, restored } = await roundTrip(day());

    expect(serialized).toEqual({
      [DATE]: { status: 'exported', layoutGeneration: GENERATION, docs: [doc] },
    });
    expect(describeIncompleteClinicalDerivedBackup(section)).toBeUndefined();
    expect(restored.kind).toBe('embedded');
    if (restored.kind !== 'embedded') throw new Error('Stable backup was not restored');
    expect(restored.needsConfirmation).toBe(true);
    expect(restored.record.beds.R2.vitalSignsHistory).toEqual(doc.vitalSignsHistory);
    expect(restored.record.beds.R2.clinicalSyncCheckpoint).toEqual(doc.clinicalSyncCheckpoint);
  });

  it('accepts a newer stable server day when no episode document is ahead of the local copy', async () => {
    firestore.getDocFromServer.mockResolvedValue(daySnapshot(day(5)));

    const { section, restored } = await roundTrip(day(4));

    expect(describeIncompleteClinicalDerivedBackup(section)).toBeUndefined();
    expect(restored.kind).toBe('embedded');
  });

  it('checks a stable day with one document query bracketed by two server day reads', async () => {
    await roundTrip(day());

    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(firestore.getDocFromServer).toHaveBeenCalledTimes(2);
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
    const [queryOrder] = firestore.getDocsFromServer.mock.invocationCallOrder;
    const [beforeOrder, afterOrder] = firestore.getDocFromServer.mock.invocationCallOrder;
    expect(beforeOrder).toBeLessThan(queryOrder);
    expect(queryOrder).toBeLessThan(afterOrder);
  });

  it.each(['orphan', 'ambiguous carrier', 'document ahead'])(
    'retains documents but warns for %s even when server reads are stable',
    async problem => {
      const local = day();
      const doc = episodeDoc();
      if (problem === 'orphan') doc.clinicalEpisodeId = 'ep_synthetic_orphan';
      if (problem === 'ambiguous carrier') {
        local.beds.R3 = DataFactory.createMockPatient('R3', { clinicalEpisodeId: EPISODE });
      }
      if (problem === 'document ahead') doc.dayRevision = 5;
      expect(ClinicalDerivedEpisodeDocSchema.safeParse(doc).success).toBe(true);
      firestore.getDocFromServer.mockResolvedValue(
        daySnapshot(problem === 'document ahead' ? day(5) : local)
      );
      firestore.getDocsFromServer.mockResolvedValue(querySnapshot([doc]));

      await expectPartialWithDocs(local, [doc]);
    }
  );

  it('accepts a stable, legitimately empty query without an incomplete warning', async () => {
    firestore.getDocsFromServer.mockResolvedValue(querySnapshot([]));

    const { section, serialized, restored } = await roundTrip(day());

    expect(serialized).toEqual({
      [DATE]: { status: 'exported', layoutGeneration: GENERATION, docs: [] },
    });
    expect(describeIncompleteClinicalDerivedBackup(section)).toBeUndefined();
    expect(restored.kind).toBe('embedded');
    if (restored.kind !== 'embedded') throw new Error('Empty stable backup was not restored');
    expect(restored.needsConfirmation).toBe(false);
  });

  it('keeps G1 documents and marks partial when the server day has already become G2', async () => {
    const g1 = episodeDoc();
    const g2 = episodeDoc({
      clinicalEpisodeId: 'ep_synthetic_snapshot_2',
      layoutGeneration: NEXT_GENERATION,
      vitalSignsHistory: [reading(99)],
    });
    firestore.getDocFromServer.mockResolvedValue(daySnapshot(day(4, NEXT_GENERATION)));
    firestore.getDocsFromServer.mockResolvedValue(querySnapshot([g1, g2]));

    await expectPartialWithDocs(day(), [g1]);
  });

  it.each([
    'first day read fails',
    'last day read fails',
    'revision changes',
    'generation changes',
    'SDK has pending writes',
    'day is missing',
  ])('preserves a successful query but cannot claim completeness when %s', async boundary => {
    if (boundary === 'first day read fails') {
      firestore.getDocFromServer.mockRejectedValueOnce({ code: 'unavailable' });
    } else if (boundary === 'last day read fails') {
      firestore.getDocFromServer
        .mockResolvedValueOnce(daySnapshot())
        .mockRejectedValueOnce({ code: 'unavailable' });
    } else if (boundary === 'day is missing') {
      firestore.getDocFromServer.mockResolvedValue({
        ...daySnapshot(),
        exists: () => false,
        data: () => undefined,
      });
    } else {
      const after =
        boundary === 'revision changes'
          ? daySnapshot(day(5))
          : boundary === 'generation changes'
            ? daySnapshot(day(4, NEXT_GENERATION))
            : daySnapshot(day(), true);
      firestore.getDocFromServer.mockResolvedValueOnce(daySnapshot()).mockResolvedValueOnce(after);
    }

    await expectPartialWithDocs(day(), [episodeDoc()]);
    expect(firestore.getDocsFromServer).toHaveBeenCalledTimes(1);
  });

  it('a failed query stays unavailable without inventing a successful empty document list', async () => {
    firestore.getDocsFromServer.mockRejectedValueOnce({ code: 'permission-denied' });

    const { section, serialized, restored } = await roundTrip(day());

    expect(serialized).toEqual({ [DATE]: { status: 'unavailable', reason: 'permission_denied' } });
    expect(describeIncompleteClinicalDerivedBackup(section)?.userSafeMessage).toContain(DATE);
    expect(restored.kind).toBe('incomplete');
  });

  it('unmarked records produce no section and no Firestore IO', async () => {
    const local = day();
    delete local.clinicalDerivedLayout;

    expect(await buildClinicalDerivedBackupSection([local])).toBeUndefined();
    for (const sdkCall of Object.values(firestore)) expect(sdkCall).not.toHaveBeenCalled();
  });
});
