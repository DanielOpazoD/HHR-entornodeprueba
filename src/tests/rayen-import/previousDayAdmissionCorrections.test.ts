import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
} from '@/features/rayen-import/domain/previousDayCorrections';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  historicalRecord,
  motherAndNewbornDiff,
  repository,
  resetPreviousDayAdmissionFixtures,
} from './previousDayAdmissionCorrections.fixtures';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn().mockResolvedValue({}),
}));

describe('previous clinical-day admission corrections', () => {
  beforeEach(resetPreviousDayAdmissionFixtures);

  afterEach(() => vi.useRealTimers());

  it('offers one confirmed correction containing both mother and clinical crib', async () => {
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );

    expect(plan.edits).toEqual([
      expect.objectContaining({
        day: '2026-07-25',
        reason: 'admission-night-shift-correction',
        patientNames: ['Maeva Elisabet Maria Tuki Garcia', 'RN de Maeva Tuki Garcia'],
        recordExists: true,
        withinEditingWindow: true,
      }),
    ]);
  });

  it('writes mother and clinical crib atomically into the preceding night census', async () => {
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );
    await fileCrossDayCorrections(
      repository,
      {
        ...historicalRecord,
        date: '2026-07-26',
      },
      { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-25',
      expect.objectContaining({
        beds: {
          H4C1: expect.objectContaining({
            clinicalEpisodeId: '143100',
            clinicalCrib: expect.objectContaining({ clinicalEpisodeId: '143101' }),
          }),
        },
      }),
      { baseRecord: historicalRecord }
    );
  });

  it('does not backdate a newborn admitted after the clinical-day handoff', async () => {
    const lateNewbornDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        patient: {
          ...admission.patient,
          clinicalCrib: admission.patient.clinicalCrib
            ? { ...admission.patient.clinicalCrib, admissionTime: '10:10' }
            : undefined,
        },
      })),
    };
    const plan = await computePreviousDayEdits(repository, lateNewbornDiff, '2026-07-26', false);

    expect(plan.edits).toEqual([
      expect.objectContaining({
        day: '2026-07-25',
        patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
        admissionSubjects: [expect.objectContaining({ kind: 'principal' })],
      }),
    ]);

    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      { ...lateNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-25',
      expect.objectContaining({
        beds: {
          H4C1: expect.objectContaining({
            clinicalEpisodeId: '143100',
            clinicalCrib: undefined,
          }),
        },
      }),
      { baseRecord: historicalRecord }
    );
  });

  it('offers and applies a crib-only correction when the mother already exists', async () => {
    const recordWithMother: DailyRecord = {
      ...historicalRecord,
      beds: {
        H4C1: {
          ...motherAndNewbornDiff.admissions[0].patient,
          clinicalCrib: undefined,
        },
      },
    };
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? recordWithMother : null
    );

    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );

    expect(plan.edits).toEqual([
      expect.objectContaining({
        patientNames: ['RN de Maeva Tuki Garcia'],
        admissionSubjects: [expect.objectContaining({ kind: 'clinical-crib' })],
      }),
    ]);

    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-25',
      expect.objectContaining({
        beds: {
          H4C1: expect.objectContaining({
            clinicalEpisodeId: '143100',
            clinicalCrib: expect.objectContaining({ clinicalEpisodeId: '143101' }),
          }),
        },
      }),
      { baseRecord: recordWithMother }
    );
  });

  it('never writes a raw admission that was not included in the confirmed preview edits', async () => {
    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      {
        ...motherAndNewbornDiff,
        previousDayEdits: [
          {
            day: '2026-07-25',
            reason: 'discharge-day-correction',
            patientNames: ['Otro paciente'],
            recordExists: true,
            withinEditingWindow: true,
            isSigned: false,
          },
        ],
      },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('does not infer a previous-day crib admission when its time is unknown', async () => {
    const unknownCribTimeDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        patient: {
          ...admission.patient,
          clinicalCrib: admission.patient.clinicalCrib
            ? { ...admission.patient.clinicalCrib, admissionTime: '' }
            : undefined,
        },
      })),
    };

    const plan = await computePreviousDayEdits(
      repository,
      unknownCribTimeDiff,
      '2026-07-26',
      false
    );

    expect(plan.edits).toEqual([
      expect.objectContaining({
        patientNames: ['Maeva Elisabet Maria Tuki Garcia'],
        admissionSubjects: [expect.objectContaining({ kind: 'principal' })],
      }),
    ]);
  });

  it('rejects instead of replacing a different newborn attached to the historical mother', async () => {
    const recordWithDifferentCrib: DailyRecord = {
      ...historicalRecord,
      beds: {
        H4C1: {
          ...motherAndNewbornDiff.admissions[0].patient,
          clinicalCrib: {
            ...EMPTY_PATIENT,
            bedId: 'H4C1',
            patientName: 'RN histórico distinto',
            clinicalEpisodeId: 'existing-crib',
          },
        },
      },
    };
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? recordWithDifferentCrib : null
    );
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );

    await expect(
      fileCrossDayCorrections(
        repository,
        { ...historicalRecord, date: '2026-07-26' },
        { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
        '2026-07-26',
        false,
        () => 'movement-id',
        { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
      )
    ).rejects.toThrow('ya conserva otro recién nacido');

    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('stores a crib under the historical bed occupied by its mother', async () => {
    const historicalMotherInAnotherBed: DailyRecord = {
      ...historicalRecord,
      beds: {
        H4C2: {
          ...motherAndNewbornDiff.admissions[0].patient,
          bedId: 'H4C2',
          clinicalCrib: undefined,
        },
      },
    };
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? historicalMotherInAnotherBed : null
    );
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );

    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      { ...motherAndNewbornDiff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    expect(patchDailyRecordWithCompatibility).toHaveBeenCalledWith(
      repository,
      '2026-07-25',
      expect.objectContaining({
        beds: {
          H4C2: expect.objectContaining({
            clinicalCrib: expect.objectContaining({
              clinicalEpisodeId: '143101',
              bedId: 'H4C2',
            }),
          }),
        },
      }),
      { baseRecord: historicalMotherInAnotherBed }
    );
  });
});
