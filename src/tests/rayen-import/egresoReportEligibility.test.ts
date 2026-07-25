import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import { selectEligibleEgresoRows } from '@/features/rayen-import/domain/egresoReportEligibility';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const emptyDiff = (): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
});

describe('egreso report eligibility', () => {
  it('does not use an unrelated RUN-less crib as admission evidence', () => {
    const diff = emptyDiff();
    diff.activeClinicalCribs = [
      {
        parentBedId: 'H5C1',
        patient: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'RN sin RUN',
          rut: '',
          clinicalEpisodeId: '',
          admissionDate: '2026-07-10',
        },
        source: {
          encounterId: 'ACTIVE-CRIB',
          run: '',
          firstGivenName: 'RN',
          firstFamilyName: 'Activo',
        },
      },
    ];
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const reportRow = {
      encounterId: 'UNRELATED-EGRESS',
      run: '',
      patientName: 'Otro RN',
      bedLabel: 'H4C1',
      servicio: 'Neonatología',
      edad: '0',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '08-07-2026 10:00',
    };

    const result = selectEligibleEgresoRows(diff, [reportRow], record);

    expect(result.rows).toEqual([reportRow]);
    expect(result.diff.conflicts).toHaveLength(0);
  });

  it('does not equate empty episodes across patients with different RUNs', () => {
    const unrelatedPatient = {
      ...EMPTY_PATIENT,
      bedId: 'H5C1',
      patientName: 'Paciente no relacionado',
      rut: '11.111.111-1',
      clinicalEpisodeId: '',
      admissionDate: '2026-07-10',
    };
    const diff = emptyDiff();
    diff.activeClinicalCribs = [
      {
        parentBedId: 'H5C1',
        patient: unrelatedPatient,
        source: { encounterId: '', run: '111111111' } as never,
      },
    ];
    diff.admissions = [
      {
        bedId: 'H4C1',
        patient: { ...unrelatedPatient, bedId: 'H4C1' },
        isCma: false,
        source: { encounterId: '', run: '111111111' } as never,
      },
    ];
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const reportRow = {
      encounterId: '',
      run: '22.222.222-2',
      patientName: 'Paciente egresado',
      bedLabel: 'H4C1',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '08-07-2026 10:00',
    };

    const result = selectEligibleEgresoRows(diff, [reportRow], record);

    expect(result.rows).toEqual([reportRow]);
    expect(result.diff.conflicts).toHaveLength(0);
  });
});
