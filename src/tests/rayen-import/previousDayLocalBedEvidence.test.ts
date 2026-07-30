import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { historicalEncounterFromLocal } from '@/features/rayen-import/domain/historicalEncounterFromLocal';
import { verifyPreviousDayAdmissionPlacements } from '@/features/rayen-import/domain/previousDayCorrections';
import { historicalRecord, motherAndNewbornDiff } from './previousDayAdmissionCorrections.fixtures';

describe('previous-day local bed evidence', () => {
  it('maps local sex to Rayen labels without guessing indeterminate values', () => {
    const patient = motherAndNewbornDiff.admissions[0].patient;

    expect(historicalEncounterFromLocal({ ...patient, biologicalSex: 'Femenino' })).toMatchObject({
      administrativeSex: 'Mujer',
      gender: 'Femenina',
    });
    expect(historicalEncounterFromLocal({ ...patient, biologicalSex: 'Masculino' })).toMatchObject({
      administrativeSex: 'Hombre',
      gender: 'Masculino',
    });
    expect(
      historicalEncounterFromLocal({ ...patient, biologicalSex: 'Indeterminado' })
    ).toMatchObject({ administrativeSex: undefined, gender: undefined });
  });

  it('uses the already-recorded mother before requesting a patient-flow PDF', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const mother = {
      ...admission.patient,
      admissionDate: '2026-07-25',
      admissionTime: '18:00',
      clinicalCrib: undefined,
    };
    const updateDiff: CensusImportDiff = {
      ...motherAndNewbornDiff,
      admissions: [],
      updates: [
        {
          bedId: 'H4C1',
          rut: mother.rut,
          patientName: mother.patientName,
          patient: mother,
          changes: [{ field: 'clinicalCrib', from: undefined, to: admission.patient.clinicalCrib }],
          source: admission.source,
        },
      ],
      summary: { ...motherAndNewbornDiff.summary, admissions: 0, updates: 1 },
    };
    const previousDayRecord: DailyRecord = {
      ...historicalRecord,
      beds: { H4C1: mother },
    };
    const fetchReport = vi.fn();

    const verified = await verifyPreviousDayAdmissionPlacements(updateDiff, '2026-07-26', {
      fetchReport,
      loadHistoricalRecord: async day => (day === '2026-07-25' ? previousDayRecord : null),
    });

    expect(fetchReport).not.toHaveBeenCalled();
    expect(verified.conflicts).toEqual([]);
    expect(verified.previousDayAdmissionCandidates).toEqual([
      expect.objectContaining({
        bedId: 'H4C1',
        source: expect.objectContaining({
          encounterId: '143100',
          verifiedBedPlacement: expect.objectContaining({
            source: 'local-census-history',
            bedId: 'H4C1',
          }),
        }),
      }),
    ]);
  });

  it('falls back to the official report when the historical census cannot be read', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'AQ==' });

    const verified = await verifyPreviousDayAdmissionPlacements(
      motherAndNewbornDiff,
      '2026-07-26',
      {
        fetchReport,
        extractText: async () =>
          [
            `Paciente: Maeva Tuki RUN: ${admission.source?.run}`,
            '26/07/2026 03:27:00 Servicio Habitación 4 Básica H4C1',
          ].join('\n'),
        loadHistoricalRecord: async () => {
          throw new Error('offline cache');
        },
      }
    );

    expect(fetchReport).toHaveBeenCalledWith(admission.source?.encounterId);
    expect(verified.conflicts).toEqual([]);
    expect(verified.admissions[0].source?.verifiedBedPlacement).toEqual(
      expect.objectContaining({ source: 'patient-flow-report', bedId: 'H4C1' })
    );
  });

  it('does not reuse a historical bed from another episode of the same patient', async () => {
    const admission = motherAndNewbornDiff.admissions[0];
    const previousEpisodeRecord: DailyRecord = {
      ...historicalRecord,
      beds: {
        H4C1: {
          ...admission.patient,
          clinicalCrib: undefined,
          clinicalEpisodeId: '142999',
        },
      },
    };
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'AQ==' });

    const verified = await verifyPreviousDayAdmissionPlacements(
      motherAndNewbornDiff,
      '2026-07-26',
      {
        fetchReport,
        extractText: async () =>
          [
            `Paciente: Maeva Tuki RUN: ${admission.source?.run}`,
            '26/07/2026 03:27:00 Servicio Habitación 4 Básica H4C1',
          ].join('\n'),
        loadHistoricalRecord: async () => previousEpisodeRecord,
      }
    );

    expect(fetchReport).toHaveBeenCalledOnce();
    expect(verified.conflicts).toEqual([]);
    expect(verified.admissions[0].source?.verifiedBedPlacement?.source).toBe('patient-flow-report');
  });
});
