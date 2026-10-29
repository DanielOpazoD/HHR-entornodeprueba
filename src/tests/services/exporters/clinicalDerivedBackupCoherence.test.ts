import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import { DataFactory } from '@/tests/factories/DataFactory';
import { reading } from './clinicalDerivedBackupRestore.test-support';
import {
  buildClinicalDerivedBackupSection,
  describeIncompleteClinicalDerivedBackup,
} from '@/services/exporters/clinicalDerivedBackupSection';
import { restoreClinicalDerivedBackupDay } from '@/services/exporters/clinicalDerivedBackupRestore';

const repository = vi.hoisted(() => ({
  readClinicalDerivedBackupDay:
    vi.fn<
      typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService').readClinicalDerivedBackupDay
    >(),
  readClinicalDerivedDaySnapshot:
    vi.fn<
      typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService').readClinicalDerivedDaySnapshot
    >(),
}));

vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => repository);

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_coherence';
const EPISODE = 'ep_synthetic_carrier';

const movedFields = () => ({
  vitalSignsHistory: [reading(73)],
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: 'synthetic-watermark', packedFacts: ['fact|hash|order'] } },
  },
});

const day = () => ({
  ...DataFactory.createMockDailyRecord(DATE, {
    lastUpdated: `${DATE}T12:00:00.000Z`,
    clinicalDerivedLayout: { version: 1, generation: GENERATION },
    beds: {
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Paciente Sintético',
        clinicalEpisodeId: EPISODE,
      }),
    },
  }),
  meta: { revision: 4 },
});

const episodeDoc = (clinicalEpisodeId: string): ClinicalDerivedEpisodeDoc => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  target: 'bed',
  bedId: 'R2',
  dayRevision: 4,
  ...movedFields(),
});

const resolveRepository = (record: ReturnType<typeof day>, doc: ClinicalDerivedEpisodeDoc) => {
  repository.readClinicalDerivedBackupDay.mockResolvedValue({
    status: 'resolved',
    layoutGeneration: GENERATION,
    docs: [doc],
  });
  repository.readClinicalDerivedDaySnapshot.mockResolvedValue({
    status: 'resolved',
    day: record,
    docs: [doc],
  });
};

describe('clinicalDerived backup export and restore coherence (D10)', () => {
  beforeEach(() => {
    repository.readClinicalDerivedBackupDay.mockReset();
    repository.readClinicalDerivedDaySnapshot.mockReset();
  });

  it('retains a valid document without its episode carrier and warns that the backup is incomplete', async () => {
    const record = day();
    const doc = episodeDoc('ep_synthetic_without_carrier');
    expect(ClinicalDerivedEpisodeDocSchema.safeParse(doc).success).toBe(true);
    resolveRepository(record, doc);

    const section = await buildClinicalDerivedBackupSection([record]);
    expect(section?.[DATE]).toMatchObject({ docs: [doc] });
    const serializedSection: unknown = JSON.parse(JSON.stringify(section));
    expect(restoreClinicalDerivedBackupDay(record, serializedSection).kind).toBe('incomplete');

    const warning = describeIncompleteClinicalDerivedBackup(section);
    expect(warning).toMatchObject({
      code: 'clinical_derived_backup_incomplete',
      severity: 'warning',
    });
    expect(warning?.userSafeMessage).toContain(DATE);
  });

  it.each(['ambiguous carrier', 'document ahead', 'zero local revision'])(
    'keeps the document but warns for %s',
    async problem => {
      const record = day();
      const doc = episodeDoc(EPISODE);
      if (problem === 'ambiguous carrier') {
        record.beds.R3 = DataFactory.createMockPatient('R3', { clinicalEpisodeId: EPISODE });
      } else if (problem === 'document ahead') {
        doc.dayRevision = 5;
      } else {
        record.meta = { revision: 0 };
      }
      const original = JSON.stringify(record);
      resolveRepository(record, doc);

      const section = await buildClinicalDerivedBackupSection([record]);

      expect(section?.[DATE]).toMatchObject({ status: 'unavailable', docs: [doc] });
      expect(describeIncompleteClinicalDerivedBackup(section)?.userSafeMessage).toContain(DATE);
      expect(JSON.stringify(record)).toBe(original);
      expect(JSON.parse(JSON.stringify(section))[DATE].docs).toEqual([doc]);
    }
  );

  it('round-trips both exact moved fields for one unique episode without an incomplete warning', async () => {
    const record = day();
    const doc = episodeDoc(EPISODE);
    resolveRepository(record, doc);

    const section = await buildClinicalDerivedBackupSection([record]);
    expect(section?.[DATE]).toMatchObject({ docs: [doc] });
    expect(describeIncompleteClinicalDerivedBackup(section)).toBeUndefined();
    const serializedSection: unknown = JSON.parse(JSON.stringify(section));
    const restored = restoreClinicalDerivedBackupDay(record, serializedSection);

    expect(restored.kind).toBe('embedded');
    if (restored.kind === 'embedded') {
      expect(restored.needsConfirmation).toBe(true);
      expect(restored.record.beds.R2.vitalSignsHistory).toEqual(movedFields().vitalSignsHistory);
      expect(restored.record.beds.R2.clinicalSyncCheckpoint).toEqual(
        movedFields().clinicalSyncCheckpoint
      );
    }
  });

  it('keeps restoring an older exported entry when its local day has no revision', () => {
    const record = { ...day(), meta: undefined };
    const doc = episodeDoc(EPISODE);
    const restored = restoreClinicalDerivedBackupDay(record, {
      [DATE]: { status: 'exported', layoutGeneration: GENERATION, docs: [doc] },
    });

    expect(restored.kind).toBe('embedded');
    if (restored.kind === 'embedded') {
      expect(restored.record.beds.R2.vitalSignsHistory).toEqual(doc.vitalSignsHistory);
    }
  });
});
