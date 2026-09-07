import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
} from '@/features/rayen-import/domain/previousDayCorrections';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  historicalRecord,
  motherAndNewbornDiff,
  repository,
  resetPreviousDayAdmissionFixtures,
} from './previousDayAdmissionCorrections.fixtures';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));
beforeEach(resetPreviousDayAdmissionFixtures);
afterEach(() => vi.useRealTimers());

it('persists a server-missing admission even when the local merged read already contains it', async () => {
  let remote = structuredClone(historicalRecord);
  const local = {
    ...remote,
    beds: { ...remote.beds, H4C1: motherAndNewbornDiff.admissions[0].patient },
  };
  const port = {
    ...repository,
    getAuthoritativeForDate: vi.fn(async () => remote),
    getForDate: vi.fn(async () => local),
    getForDateWithMeta: vi.fn(),
  };
  port.getForDateWithMeta.mockResolvedValue({ record: local });
  vi.mocked(patchDailyRecordWithCompatibility).mockImplementation(
    async (_port, date, patch, options) => {
      expect(options?.baseRecord).toBe(remote);
      remote = { ...remote, beds: { ...remote.beds, ...patch.beds } };
      return createUpdatePartialDailyRecordResult({
        date,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
      });
    }
  );
  const plan = await computePreviousDayEdits(port, motherAndNewbornDiff, '2026-07-26', false);
  expect(plan.edits).toHaveLength(1);
  await expect(
    fileCrossDayCorrections(
      port,
      historicalRecord,
      { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'id',
      { syncRunId: 'divergent-local' }
    )
  ).resolves.toEqual({ confirmed: 1, durablyQueued: 0, omitted: [] });
  expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
  expect(port.getForDateWithMeta).not.toHaveBeenCalled();
  expect(
    (await computePreviousDayEdits(port, motherAndNewbornDiff, '2026-07-26', false)).edits
  ).toEqual([]);
});

it('does not propose an admission already on the server even with an empty local copy', async () => {
  const port = {
    ...repository,
    getAuthoritativeForDate: vi.fn(async () => ({
      ...historicalRecord,
      beds: { H4C1: motherAndNewbornDiff.admissions[0].patient },
    })),
    getForDate: vi.fn(async () => historicalRecord),
  };
  expect(
    (await computePreviousDayEdits(port, motherAndNewbornDiff, '2026-07-26', false)).edits
  ).toEqual([]);
});

it('does not fall back to local state when the authoritative confirmation read fails', async () => {
  const plan = await computePreviousDayEdits(repository, motherAndNewbornDiff, '2026-07-26', false);
  const port = {
    ...repository,
    getAuthoritativeForDate: vi.fn().mockRejectedValue(new Error('server unavailable')),
    getForDate: vi.fn(async () => historicalRecord),
  };
  await expect(
    fileCrossDayCorrections(
      port,
      historicalRecord,
      { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'id',
      { syncRunId: 'unavailable' }
    )
  ).rejects.toThrow('server unavailable');
  expect(port.getForDate).not.toHaveBeenCalled();
  expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
});

it.each([false, true])(
  'confirms a night admission once without clinical writes (existing mother: %s)',
  async existingMother => {
    const clinical = {
      vitalSigns: {
        heartRate: 80,
        recordedDate: '2026-07-25',
        recordedAt: '2026-07-25T22:00:00',
        systolic: null,
        diastolic: null,
        spo2: null,
        temperature: null,
        respiratoryRate: null,
        painEva: null,
        hgt: null,
        insulinUnits: null,
        insulinQuadrant: null,
        observations: null,
        author: 'Profesional prueba',
        authorRole: 'Enfermería',
      },
      clinicalSyncCheckpoint: { version: 1, fingerprintVersion: 1, sources: {} },
    };
    const record = {
      ...historicalRecord,
      beds: {
        R1: { ...EMPTY_PATIENT, bedId: 'R1', patientName: 'Otro paciente', ...clinical },
      },
    };
    const diff = structuredClone(motherAndNewbornDiff);
    Object.assign(diff.admissions[0].patient, clinical);
    Object.assign(diff.admissions[0].patient.clinicalCrib!, clinical);
    let persisted: typeof historicalRecord = {
      ...record,
      beds: {
        ...record.beds,
        ...(existingMother
          ? { H4C1: { ...diff.admissions[0].patient, clinicalCrib: undefined } }
          : {}),
      },
    };
    vi.mocked(repository.getForDate).mockImplementation(async () => persisted);
    vi.mocked(patchDailyRecordWithCompatibility).mockImplementation(async (_port, _day, patch) => {
      const json = JSON.stringify(patch);
      for (const field of RAYEN_OWNED_CLINICAL_FIELDS) {
        expect(json).not.toContain(`"${field}"`);
      }
      expect(Object.keys(patch.beds!)).toEqual(['H4C1']);
      persisted = {
        ...persisted,
        beds: {
          ...persisted.beds,
          H4C1: { ...persisted.beds.H4C1, ...patch.beds!.H4C1 },
        },
      };
      return createUpdatePartialDailyRecordResult({
        date: _day,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
      });
    });
    const plan = await computePreviousDayEdits(repository, diff, '2026-07-26', false);
    await expect(
      fileCrossDayCorrections(
        repository,
        record,
        { ...diff, previousDayEdits: plan.edits },
        '2026-07-26',
        false,
        () => 'id',
        { syncRunId: 'test-run' }
      )
    ).resolves.toEqual({ confirmed: 1, durablyQueued: 0, omitted: [] });
    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
    expect(record.beds.R1.vitalSigns).toEqual(clinical.vitalSigns);
    expect(diff.admissions[0].patient.vitalSigns).toEqual(clinical.vitalSigns);
    expect((await computePreviousDayEdits(repository, diff, '2026-07-26', false)).edits).toEqual(
      []
    );
    if (existingMother) expect(persisted.beds.H4C1.vitalSigns).toEqual(clinical.vitalSigns);
  }
);
