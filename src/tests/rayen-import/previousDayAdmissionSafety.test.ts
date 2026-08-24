import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
  verifyPreviousDayAdmissionPlacements,
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

describe('previous clinical-day admission evidence and safety', () => {
  beforeEach(resetPreviousDayAdmissionFixtures);

  afterEach(() => vi.useRealTimers());

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

  it('keeps the current-day admission and retries historical evidence on a later sync', async () => {
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
      fetchReport: vi.fn().mockRejectedValue(new Error('temporary extension failure')),
    });

    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
    expect(verified.deferredHistoricalAdmissionBedIds).toEqual(['H4C1']);
    expect(verified.admissions[0].patient.admissionDate).toBe(
      unverifiedDiff.admissions[0].patient.admissionDate
    );
    expect(verified.admissions[0].patient.admissionTime).toBe(
      unverifiedDiff.admissions[0].patient.admissionTime
    );
    expect(verified.conflicts).toEqual([]);
    expect(verified.summary.conflicts).toBe(0);

    const retried = await verifyPreviousDayAdmissionPlacements(verified, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(['RUN: 17.059.646-3', '26/07/2026 03:30:00 Habitación 4 C1'].join('\n')),
    });

    expect(retried.admissions[0].source?.verifiedBedPlacement).toEqual(
      expect.objectContaining({ bedId: 'H4C1' })
    );
    expect(retried.deferredHistoricalAdmissionBedIds).toBeUndefined();
    expect(retried.conflicts).toEqual([]);
    expect(retried.summary.conflicts).toBe(0);
  });

  it('clears stale placement evidence when the encounter cannot be verified', async () => {
    const staleEvidenceDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: motherAndNewbornDiff.admissions.map(admission => ({
        ...admission,
        source: admission.source
          ? {
              ...admission.source,
              encounterId: 'invalid',
              verifiedBedPlacement: {
                source: 'patient-flow-report',
                bedId: 'H4C1',
                changedAt: '2026-07-26T03:30:00',
              },
            }
          : undefined,
      })),
    };
    const fetchReport = vi.fn();

    const verified = await verifyPreviousDayAdmissionPlacements(staleEvidenceDiff, '2026-07-26', {
      fetchReport,
    });
    const plan = await computePreviousDayEdits(repository, verified, '2026-07-26', false);

    expect(fetchReport).not.toHaveBeenCalled();
    expect(verified.admissions[0].source?.verifiedBedPlacement).toBeUndefined();
    expect(verified.deferredHistoricalAdmissionBedIds).toEqual(['H4C1']);
    expect(verified.conflicts).toEqual([]);
    expect(plan.edits).toEqual([]);
  });

  it('rebuilds a preceding-night mother and crib candidate when the current sync is unchanged', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const mother = admission.patient;
    const crib = mother.clinicalCrib as NonNullable<typeof mother.clinicalCrib>;
    const newbornSource = {
      ...admission.source!,
      encounterId: '143101',
      run: '',
      firstGivenName: 'RN de Maeva',
      admissionDatetime: '2026-07-26T05:10:00-06:00',
      clinicalCribParentBedId: 'H4C1',
      verifiedBedPlacement: undefined,
    };
    const unchangedDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: [],
      updates: [],
      unchangedCount: 2,
      activeClinicalCribs: [
        {
          parentBedId: 'H4C1',
          principalRut: mother.rut,
          patient: crib,
          source: newbornSource,
        },
      ],
      summary: {
        ...motherAndNewbornDiff.summary,
        admissions: 0,
        updates: 0,
        unchanged: 2,
      },
    };
    const currentRecord: DailyRecord = {
      ...historicalRecord,
      date: '2026-07-26',
      beds: { H4C1: mother },
    };

    const failed = await verifyPreviousDayAdmissionPlacements(unchangedDiff, '2026-07-26', {
      fetchReport: vi.fn().mockRejectedValue(new Error('temporary extension failure')),
      snapshot: {
        capturedAt: '2026-07-26T12:00:00-06:00',
        facilityId: 1342,
        encounters: [admission.source!, newbornSource],
      },
      currentRecord,
    });
    const verified = await verifyPreviousDayAdmissionPlacements(failed, '2026-07-26', {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi
        .fn()
        .mockResolvedValue(['RUN: 17.059.646-3', '26/07/2026 03:30:00 Habitación 4 C1'].join('\n')),
    });
    const plan = await computePreviousDayEdits(repository, verified, '2026-07-26', false);

    expect(failed.conflicts).toEqual([]);
    expect(verified.previousDayAdmissionCandidates).toEqual([
      expect.objectContaining({
        bedId: 'H4C1',
        patient: expect.objectContaining({
          patientName: 'Maeva Elisabet Maria Tuki Garcia',
          clinicalCrib: expect.objectContaining({ patientName: 'RN de Maeva Tuki Garcia' }),
        }),
        source: expect.objectContaining({
          encounterId: '143100',
          verifiedBedPlacement: expect.objectContaining({ bedId: 'H4C1' }),
        }),
      }),
    ]);
    expect(verified.conflicts).toEqual([]);
    expect(plan.edits).toEqual([
      expect.objectContaining({
        patientNames: ['Maeva Elisabet Maria Tuki Garcia', 'RN de Maeva Tuki Garcia'],
        admissionSubjects: [
          expect.objectContaining({ kind: 'principal' }),
          expect.objectContaining({ kind: 'clinical-crib' }),
        ],
      }),
    ]);
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

  it('does not request historical evidence for a same-day crib whose admission time is unknown', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const unknownCribTimeDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: [
        {
          ...admission,
          patient: {
            ...admission.patient,
            clinicalCrib: admission.patient.clinicalCrib
              ? { ...admission.patient.clinicalCrib, admissionTime: '' }
              : undefined,
          },
          source: admission.source
            ? {
                ...admission.source,
                admissionDatetime: '2026-07-25T18:00:00-06:00',
                verifiedBedPlacement: undefined,
              }
            : undefined,
        },
      ],
    };
    const fetchReport = vi.fn();

    const verified = await verifyPreviousDayAdmissionPlacements(unknownCribTimeDiff, '2026-07-26', {
      fetchReport,
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(verified.conflicts).toEqual([]);
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
