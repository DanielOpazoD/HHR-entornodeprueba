import { describe, expect, it } from 'vitest';
import { applyEgresoLookupFallback, type CensusImportDiff } from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeDiff = (): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [
    {
      bedId: 'R2',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      signal: 'missing-from-ficha',
      encounterId: '141704',
      verification: {
        medicalEpicrisis: 'unknown',
        nursingEpicrisis: 'unknown',
        hospitalDischarge: 'not-detected',
      },
    },
  ],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 1,
    conflicts: 0,
    unchanged: 0,
  },
});

const makeRecord = (): DailyRecord => ({
  date: '2026-07-19',
  beds: {
    R2: {
      ...EMPTY_PATIENT,
      bedId: 'R2',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      clinicalEpisodeId: '141704',
      admissionDate: '2026-07-18',
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

describe('applyEgresoLookupFallback', () => {
  it('converts an offset API timestamp to the Rapa Nui census clock', () => {
    const enriched = applyEgresoLookupFallback(
      makeDiff(),
      [
        {
          run: '220253899',
          encounterId: '141704',
          egreso: {
            hasAdministrativeDischarge: true,
            dateDischarge: '2026-07-20T01:37:00.000Z',
            dischargeDestination: 'Domicilio',
          },
        },
      ],
      makeRecord()
    );

    expect(enriched.discharges[0]).toMatchObject({
      correctedDay: '2026-07-19',
      correctedTime: '19:37',
    });
  });

  it('recovers the official egreso missed by the bulk report for exact encounter 141704', () => {
    const enriched = applyEgresoLookupFallback(
      makeDiff(),
      [
        {
          run: '220253899',
          encounterId: '141704',
          egreso: {
            id: 141704,
            endPeriod: '2026-07-19T17:10:00-04:00',
            hasMedicalDischarge: true,
            hasNurseDischarge: true,
            hasAdministrativeDischarge: true,
            dischargeDestinationName: 'Domicilio',
          },
        },
      ],
      makeRecord()
    );

    expect(enriched.pendingAdministrativeDischarges).toHaveLength(0);
    expect(enriched.discharges[0]).toMatchObject({
      bedId: 'R2',
      encounterId: '141704',
      correctedDay: '2026-07-19',
      correctedTime: '15:10',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'confirmed',
        hospitalDischarge: 'confirmed',
      },
    });
  });

  it('rejects another hospitalization of the same RUN', () => {
    const diff = makeDiff();
    const enriched = applyEgresoLookupFallback(
      diff,
      [
        {
          run: '220253899',
          encounterId: '120001',
          egreso: { id: 120001, endPeriod: '2025-01-02T10:00:00-03:00' },
        },
      ],
      makeRecord()
    );

    expect(enriched).toBe(diff);
    expect(enriched.discharges).toHaveLength(0);
  });

  it('selects the exact episode when the same RUN has multiple pending hospitalizations', () => {
    const diff = makeDiff();
    diff.pendingAdministrativeDischarges.unshift({
      ...diff.pendingAdministrativeDischarges[0],
      bedId: 'R1',
      encounterId: '120001',
    });

    const enriched = applyEgresoLookupFallback(
      diff,
      [
        {
          run: '220253899',
          encounterId: '141704',
          egreso: {
            id: 141704,
            endPeriod: '2026-07-19T17:10:00-04:00',
            hasAdministrativeDischarge: true,
          },
        },
      ],
      makeRecord()
    );

    expect(enriched.discharges).toContainEqual(
      expect.objectContaining({ bedId: 'R2', encounterId: '141704' })
    );
  });

  it('respects an explicit administrative-discharge false even when an end date exists', () => {
    const diff = makeDiff();
    const enriched = applyEgresoLookupFallback(
      diff,
      [
        {
          run: '220253899',
          encounterId: '141704',
          egreso: {
            id: 141704,
            endPeriod: '2026-07-19T17:10:00-04:00',
            hasAdministrativeDischarge: false,
          },
        },
      ],
      makeRecord()
    );

    expect(enriched).toBe(diff);
    expect(enriched.discharges).toHaveLength(0);
  });
});
