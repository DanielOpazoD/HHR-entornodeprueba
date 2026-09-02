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
  it('ignores an episode-less discharge that predates a known active readmission', () => {
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {
        R2: {
          ...EMPTY_PATIENT,
          bedId: 'R2',
          patientName: 'Paciente reingresado',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'EPISODE-NEW',
          admissionDate: '2026-07-10',
          admissionTime: '10:00',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const reportRow = {
      encounterId: '',
      run: '11.111.111-1',
      patientName: 'Paciente reingresado',
      bedLabel: 'R2',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '09-07-2026 12:00',
    };

    const result = selectEligibleEgresoRows(emptyDiff(), [reportRow], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toEqual([]);
  });

  it('un alta ya registrada en HHR no reaparece como conflicto en cada re-sincronización', () => {
    // El informe de GC re-enumera las altas del día completo; si la vinculación
    // exacta degrada (lookup ambiguo, PDF caído), la fila queda 'unverified' y
    // antes exigía revisión aunque el paciente ya estuviera egresado en HHR.
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {},
      discharges: [{ rut: '11.111.111-1', patientName: 'Paciente Egresado' } as never],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const row = {
      encounterId: '',
      run: '11.111.111-1',
      patientName: 'Paciente Egresado',
      bedLabel: 'R2',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '10-07-2026 09:00',
      exactEpisodeVerification: 'unverified' as const,
    };

    const result = selectEligibleEgresoRows(emptyDiff(), [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toEqual([]);
  });

  it('el mismo RUN reingresado y aún en cama sí conserva la exigencia de revisión', () => {
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {
        R3: {
          ...EMPTY_PATIENT,
          bedId: 'R3',
          patientName: 'Paciente Reingresado',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'EP-NUEVO',
          admissionDate: '2026-07-10',
          admissionTime: '08:00',
        },
      },
      discharges: [{ rut: '11.111.111-1', patientName: 'Paciente Reingresado' } as never],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const row = {
      encounterId: '',
      run: '11.111.111-1',
      patientName: 'Paciente Reingresado',
      bedLabel: 'R3',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '10-07-2026 12:00',
      exactEpisodeVerification: 'unverified' as const,
    };

    const result = selectEligibleEgresoRows(emptyDiff(), [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toHaveLength(1);
    expect(result.diff.conflicts[0]?.reason).toContain('no pudo vincularse');
  });

  it('does not duplicate the same report conflict when evidence is reconciled twice', () => {
    const record: DailyRecord = {
      date: '2026-07-10',
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const invalidRow = {
      encounterId: 'EPISODE-1',
      run: '11.111.111-1',
      patientName: 'Paciente',
      bedLabel: 'R2',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: 'fecha inválida',
    };

    const first = selectEligibleEgresoRows(emptyDiff(), [invalidRow], record);
    const second = selectEligibleEgresoRows(
      first.diff,
      [{ ...invalidRow, run: '111111111' }],
      record
    );

    expect(second.diff.conflicts).toHaveLength(1);
    expect(second.diff.summary.conflicts).toBe(1);
    expect(second.diff.conflicts[0]?.reason).toContain('RUN 111111111');
  });

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

  it('madre y RN bajo el mismo RUN: el informe queda ambiguo, pero el alta ya planificada por Ficha Médico no es un conflicto', () => {
    // Visto en vivo (02-09, H5C1): las dos filas del informe comparten RUN → la
    // vinculación exacta es ambigua ('unverified') y se exigía revisión de un alta
    // que sí se aplicaba (la madre por el censo; la cuna como alta asociada).
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H5C1: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'Tania Cristina Valencia Ladino',
          rut: '28.106.852-0',
          clinicalEpisodeId: 'EP-MADRE',
          admissionDate: '2026-08-31',
          clinicalCrib: {
            ...EMPTY_PATIENT,
            bedId: 'H5C1',
            patientName: 'Rn De Tania Valencia Ladino',
            rut: '28.106.852-0',
            clinicalEpisodeId: 'EP-RN',
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const diff: CensusImportDiff = {
      ...emptyDiff(),
      discharges: [
        {
          bedId: 'H5C1',
          rut: '28.106.852-0',
          patientName: 'Tania Cristina Valencia Ladino',
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: 'EP-MADRE',
        } as CensusImportDiff['discharges'][number],
      ],
    };
    const baseRow = {
      encounterId: '',
      run: '28.106.852-0',
      bedLabel: 'H5C1',
      servicio: 'Ginecobstetricia',
      edad: '18',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 10:00',
      exactEpisodeVerification: 'unverified' as const,
    };
    const rows = [
      { ...baseRow, patientName: 'Tania Cristina Valencia Ladino' },
      { ...baseRow, patientName: 'Rn De Tania Valencia Ladino', edad: '0' },
    ];

    const result = selectEligibleEgresoRows(diff, rows, record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toEqual([]);
  });

  it('con una cuna ocupada y un egreso planificado que no es alta viva, la fila ambigua conserva la revisión', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H5C1: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'Madre Trasladada',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'EP-MADRE',
          clinicalCrib: {
            ...EMPTY_PATIENT,
            bedId: 'H5C1',
            patientName: 'Rn De Madre Trasladada',
            rut: '22.222.222-2',
            clinicalEpisodeId: 'EP-RN',
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const diff: CensusImportDiff = {
      ...emptyDiff(),
      discharges: [
        {
          bedId: 'H5C1',
          rut: '22.222.222-2',
          patientName: 'Madre Trasladada',
          kind: 'traslado',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: 'EP-MADRE',
        } as CensusImportDiff['discharges'][number],
      ],
    };
    const row = {
      encounterId: '',
      run: '22.222.222-2',
      patientName: 'Rn De Madre Trasladada',
      bedLabel: 'H5C1',
      servicio: 'Ginecobstetricia',
      edad: '0',
      destino: 'Traslado',
      motivo: 'Traslado',
      fechaEgreso: '02-09-2026 10:00',
      exactEpisodeVerification: 'unverified' as const,
    };

    const result = selectEligibleEgresoRows(diff, [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toHaveLength(1);
    expect(result.diff.conflicts[0]?.reason).toContain('no pudo vincularse');
  });

  it('sin cuna, una fila ambigua de un paciente cuyo egreso ya planifica el censo no exige revisión', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        R2: {
          ...EMPTY_PATIENT,
          bedId: 'R2',
          patientName: 'Paciente Egresando',
          rut: '33.333.333-3',
          clinicalEpisodeId: 'EP-1',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const diff: CensusImportDiff = {
      ...emptyDiff(),
      discharges: [
        {
          bedId: 'R2',
          rut: '33.333.333-3',
          patientName: 'Paciente Egresando',
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: 'EP-1',
        } as CensusImportDiff['discharges'][number],
      ],
    };
    const row = {
      encounterId: '',
      run: '33.333.333-3',
      patientName: 'Paciente Egresando',
      bedLabel: 'R2',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 10:00',
      exactEpisodeVerification: 'unverified' as const,
    };

    const result = selectEligibleEgresoRows(diff, [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toEqual([]);
  });
});
