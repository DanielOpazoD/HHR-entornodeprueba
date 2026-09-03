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

  it('una fila D+1 o inválida del mismo RUN no retiene la etiqueta de redundancia de la fila de hoy', () => {
    // La etiqueta `unverified-report-row` permite que applyEgresoReport descarte la
    // revisión si el lookup exacto construye el egreso; solo cuentan las filas que
    // este mismo filtro deja pasar (estampa válida y dentro del día).
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H5C1: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'Tania Valencia',
          rut: '28.106.852-0',
          clinicalEpisodeId: '1001',
          admissionDate: '2026-08-31',
          admissionTime: '10:00',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const base = {
      encounterId: '',
      run: '28.106.852-0',
      patientName: 'Tania Valencia',
      bedLabel: 'H5C1',
      servicio: 'Ginecobstetricia',
      edad: '18',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      exactEpisodeVerification: 'unverified' as const,
    };
    const today = { ...base, fechaEgreso: '02-09-2026 10:00' };
    const nextDay = { ...base, fechaEgreso: '03-09-2026 15:00' };
    const invalid = { ...base, fechaEgreso: 'sin fecha' };

    const result = selectEligibleEgresoRows(emptyDiff(), [today, nextDay, invalid], record);

    expect(result.rows).toEqual([]);
    const unlinked = result.diff.conflicts.filter(c => c.reason.includes('no pudo vincularse'));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ bedId: 'H5C1', code: 'unverified-report-row' });
  });

  it('con más filas de hoy de las que la cama explica (gemelos), la revisión queda sin etiqueta', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H5C1: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'Tania Valencia',
          rut: '28.106.852-0',
          clinicalEpisodeId: '1001',
          admissionDate: '2026-08-31',
          admissionTime: '10:00',
          clinicalCrib: {
            ...EMPTY_PATIENT,
            bedId: 'H5C1',
            bedMode: 'Cuna',
            patientName: 'Rn 1',
            rut: '28.106.852-0',
            clinicalEpisodeId: '1002',
            admissionDate: '2026-08-31',
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const base = {
      encounterId: '',
      run: '28.106.852-0',
      bedLabel: 'H5C1',
      servicio: 'Ginecobstetricia',
      edad: '0',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 10:00',
      exactEpisodeVerification: 'unverified' as const,
    };
    const rows = [
      { ...base, patientName: 'Tania Valencia', edad: '18' },
      { ...base, patientName: 'Rn 1' },
      { ...base, patientName: 'Rn 2' },
    ];

    const result = selectEligibleEgresoRows(emptyDiff(), rows, record);

    const unlinked = result.diff.conflicts.filter(c => c.reason.includes('no pudo vincularse'));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]?.code).toBeUndefined();
  });

  it('una fecha de egreso inválida para un ocupante conocido conserva su cama en el conflicto (no bloquea todo el censo)', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H4C2: {
          ...EMPTY_PATIENT,
          bedId: 'H4C2',
          patientName: 'Paciente Con Fecha Rota',
          rut: '12.345.678-5',
          clinicalEpisodeId: '4242',
          admissionDate: '2026-08-30',
          admissionTime: '09:00',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const row = {
      encounterId: '',
      run: '12.345.678-5',
      patientName: 'Paciente Con Fecha Rota',
      bedLabel: 'H4C2',
      servicio: 'Medicina',
      edad: '50',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: 'sin fecha',
    };

    const result = selectEligibleEgresoRows(emptyDiff(), [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toHaveLength(1);
    expect(result.diff.conflicts[0]).toMatchObject({
      bedId: 'H4C2',
      patientName: 'Paciente Con Fecha Rota',
    });
    expect(result.diff.conflicts[0]?.reason).toContain('fecha/hora de egreso inválida');
  });

  it('una fecha inválida en la fila de un RN en cuna conserva la cama de la madre y el nombre del RN', () => {
    const record: DailyRecord = {
      date: '2026-09-02',
      beds: {
        H5C1: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          patientName: 'Ana Perez',
          rut: '20.000.000-1',
          clinicalEpisodeId: '1001',
          admissionDate: '2026-08-30',
          admissionTime: '09:00',
          clinicalCrib: {
            ...EMPTY_PATIENT,
            bedId: 'H5C1',
            bedMode: 'Cuna',
            patientName: 'Rn De Ana Perez',
            rut: '27.999.999-9',
            clinicalEpisodeId: '1002',
            admissionDate: '2026-08-30',
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };
    const row = {
      encounterId: '1002',
      run: '27.999.999-9',
      patientName: 'Rn De Ana Perez',
      bedLabel: 'H5C1',
      servicio: 'Neonatología',
      edad: '0',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '',
    };

    const result = selectEligibleEgresoRows(emptyDiff(), [row], record);

    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toHaveLength(1);
    expect(result.diff.conflicts[0]).toMatchObject({
      bedId: 'H5C1',
      patientName: 'Rn De Ana Perez',
    });
  });
});
