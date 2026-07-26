import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
  verifyPreviousDayAdmissionPlacements,
} from '@/features/rayen-import/domain/previousDayCorrections';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn().mockResolvedValue({}),
}));

const historicalRecord: DailyRecord = {
  date: '2026-07-25',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: 'before',
};

const motherAndNewbornDiff: CensusImportDiff = {
  admissions: [
    {
      bedId: 'H4C1',
      isCma: false,
      patient: {
        ...EMPTY_PATIENT,
        bedId: 'H4C1',
        patientName: 'Maeva Elisabet Maria Tuki Garcia',
        rut: '17.059.646-3',
        clinicalEpisodeId: '143100',
        admissionDate: '2026-07-26',
        admissionTime: '03:27',
        clinicalCrib: {
          ...EMPTY_PATIENT,
          bedId: 'H4C1',
          bedMode: 'Cuna',
          patientName: 'RN de Maeva Tuki Garcia',
          clinicalEpisodeId: '143101',
          admissionDate: '2026-07-26',
          admissionTime: '05:10',
        },
      },
      source: {
        encounterId: '143100',
        run: '170596463',
        firstGivenName: 'Maeva Elisabet Maria',
        firstFamilyName: 'Tuki',
        secondFamilyName: 'Garcia',
        admissionDatetime: '2026-07-26T03:27:00-06:00',
        room: 'H4',
        bed: 'C1',
        verifiedBedPlacement: {
          source: 'patient-flow-report',
          bedId: 'H4C1',
          changedAt: '2026-07-26T03:27:00',
        },
      },
    },
  ],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
};

const repository = {
  getForDate: vi.fn(async (day: string) => (day === '2026-07-25' ? historicalRecord : null)),
} as unknown as DailyRecordRepositoryPort;

describe('previous clinical-day admission corrections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
    vi.clearAllMocks();
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? historicalRecord : null
    );
  });

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

  it('proves the preceding-night bed from patient traceability before offering a correction', async () => {
    const unverifiedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? { ...admission.source, verifiedBedPlacement: undefined }
          : undefined,
      })),
    };
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'cGRm' });

    const verified = await verifyPreviousDayAdmissionPlacements(unverifiedDiff, '2026-07-26', {
      fetchReport,
      extractText: vi
        .fn()
        .mockResolvedValue(['RUN: 17.059.646-3', '26/07/2026 03:30:00 Habitación 4 C1'].join('\n')),
    });

    expect(fetchReport).toHaveBeenCalledWith('143100');
    expect(verified.admissions[0].source?.verifiedBedPlacement).toEqual({
      source: 'patient-flow-report',
      bedId: 'H4C1',
      changedAt: '2026-07-26T03:30:00',
    });
  });

  it('excludes a bed movement made exactly at the clinical-day handoff', async () => {
    const unverifiedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? { ...admission.source, verifiedBedPlacement: undefined }
          : undefined,
      })),
    };

    const verified = await verifyPreviousDayAdmissionPlacements(unverifiedDiff, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(
          [
            'RUN: 17.059.646-3',
            '26/07/2026 03:30:00 Habitación 4 C1',
            '26/07/2026 09:00:00 Habitación 4 C2',
          ].join('\n')
        ),
    });

    expect(verified.admissions[0].source?.verifiedBedPlacement).toEqual(
      expect.objectContaining({ bedId: 'H4C1' })
    );
  });

  it('does not request historical admission evidence for an older long-stay admission', async () => {
    const longStayDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        patient: { ...admission.patient, clinicalCrib: undefined },
        source: admission.source
          ? {
              ...admission.source,
              admissionDatetime: '2026-07-20T15:00:00-06:00',
              verifiedBedPlacement: undefined,
            }
          : undefined,
      })),
    };
    const fetchReport = vi.fn();

    const verified = await verifyPreviousDayAdmissionPlacements(longStayDiff, '2026-07-26', {
      fetchReport,
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
  });

  it('does not offer CMA admissions as historical bed corrections', async () => {
    const cmaDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        isCma: true,
      })),
    };

    const plan = await computePreviousDayEdits(repository, cmaDiff, '2026-07-26', false);

    expect(plan.edits).toEqual([]);
  });

  it('normalizes the principal embedded bed ID to the proven historical bed', async () => {
    const historicalBedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? {
              ...admission.source,
              verifiedBedPlacement: {
                source: 'patient-flow-report',
                bedId: 'H4C2',
                changedAt: '2026-07-26T03:30:00',
              },
            }
          : undefined,
      })),
    };
    const plan = await computePreviousDayEdits(repository, historicalBedDiff, '2026-07-26', false);

    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      { ...historicalBedDiff, previousDayEdits: plan.edits },
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
            bedId: 'H4C2',
            clinicalEpisodeId: '143100',
          }),
        },
      }),
      { baseRecord: historicalRecord }
    );
  });

  it('revalidates that the historical record is still unsigned before writing', async () => {
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );
    const signedAfterPreview: DailyRecord = {
      ...historicalRecord,
      medicalSignature: {
        doctorName: 'Médico prueba',
        signedAt: '2026-07-26T12:00:00.000Z',
      },
    };
    vi.mocked(repository.getForDate).mockResolvedValue(signedAfterPreview);

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
    ).rejects.toThrow('fue firmado después de la revisión');

    expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
  });

  it('backfills a new crib when the current-day reconciliation represents it as a mother update', async () => {
    const mother = {
      ...motherAndNewbornDiff.admissions[0].patient,
      admissionDate: '2026-07-25',
      admissionTime: '18:00',
      clinicalCrib: undefined,
    };
    const crib = motherAndNewbornDiff.admissions[0].patient.clinicalCrib as NonNullable<
      (typeof motherAndNewbornDiff.admissions)[number]['patient']['clinicalCrib']
    >;
    const updateDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: [],
      updates: [
        {
          bedId: 'H4C1',
          rut: mother.rut,
          patientName: mother.patientName,
          patient: mother,
          changes: [{ field: 'clinicalCrib', from: undefined, to: crib }],
          source: motherAndNewbornDiff.admissions[0].source,
        },
      ],
    };
    const recordWithMother: DailyRecord = {
      ...historicalRecord,
      beds: { H4C1: mother },
    };
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? recordWithMother : null
    );

    const verified = await verifyPreviousDayAdmissionPlacements(updateDiff, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(['RUN: 17.059.646-3', '26/07/2026 03:30:00 Habitación 4 C1'].join('\n')),
    });
    const plan = await computePreviousDayEdits(repository, verified, '2026-07-26', false);

    expect(plan.edits).toEqual([
      expect.objectContaining({
        patientNames: ['RN de Maeva Tuki Garcia'],
        admissionSubjects: [expect.objectContaining({ kind: 'clinical-crib' })],
      }),
    ]);

    await fileCrossDayCorrections(
      repository,
      { ...historicalRecord, date: '2026-07-26' },
      { ...verified, previousDayEdits: plan.edits },
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
            clinicalCrib: expect.objectContaining({ clinicalEpisodeId: '143101' }),
          }),
        },
      }),
      { baseRecord: recordWithMother }
    );
  });

  it('does not offer a crib backfill for a historical bed that cannot hold a clinical crib', async () => {
    const unsupportedBedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? {
              ...admission.source,
              verifiedBedPlacement: {
                source: 'patient-flow-report',
                bedId: 'H3C1',
                changedAt: '2026-07-26T03:30:00',
              },
            }
          : undefined,
      })),
    };
    const motherInUnsupportedBed: DailyRecord = {
      ...historicalRecord,
      beds: {
        H3C1: {
          ...unsupportedBedDiff.admissions[0].patient,
          bedId: 'H3C1',
          clinicalCrib: undefined,
        },
      },
    };
    vi.mocked(repository.getForDate).mockImplementation(async day =>
      day === '2026-07-25' ? motherInUnsupportedBed : null
    );

    const plan = await computePreviousDayEdits(repository, unsupportedBedDiff, '2026-07-26', false);

    expect(plan.edits).toEqual([]);
  });
});
