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

describe('reingreso el mismo día', () => {
  const readmission = (discharges: unknown[]) =>
    ({
      date: '2026-11-01',
      beds: {
        R2: {
          ...EMPTY_PATIENT,
          bedId: 'R2',
          patientName: 'Paciente Sintético',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'synthetic-new',
          admissionDate: '2026-11-01',
          admissionTime: '20:24',
        },
      },
      discharges,
      transfers: [],
      cma: [],
    }) as unknown as DailyRecord;
  const row = (fechaEgreso: string) =>
    ({
      encounterId: '',
      run: '11.111.111-1',
      patientName: 'Paciente Sintético',
      bedLabel: 'R2',
      fechaEgreso,
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      exactEpisodeVerification: 'unverified',
    }) as never;
  const applied = {
    rut: '11.111.111-1',
    clinicalEpisodeId: 'synthetic-old',
    time: '11:55',
    movementDate: '2026-11-01',
    bedId: 'R2',
  };

  it('no reabre un alta ya aplicada anterior al episodio activo', () => {
    const result = selectEligibleEgresoRows(
      emptyDiff(),
      [row('01-11-2026 11:55')],
      readmission([applied])
    );
    expect(result.rows).toEqual([]);
    expect(result.diff.conflicts).toEqual([]);
  });

  it.each([
    ['el alta no se aplicó', '01-11-2026 11:55', []],
    ['el alta es posterior al ingreso activo', '01-11-2026 23:00', [applied]],
    [
      'el alta registrada es del episodio activo',
      '01-11-2026 11:55',
      [{ ...applied, clinicalEpisodeId: 'synthetic-new' }],
    ],
    [
      'el alta registrada no tiene episodio',
      '01-11-2026 11:55',
      [{ ...applied, clinicalEpisodeId: '' }],
    ],
    ['la fila no coincide con el alta registrada', '01-11-2026 16:00', [applied]],
    ['el alta registrada es de otra cama', '01-11-2026 11:55', [{ ...applied, bedId: 'R1' }]],
    [
      'el alta registrada no tiene día',
      '01-11-2026 11:55',
      [{ ...applied, movementDate: undefined }],
    ],
    ['la hora registrada está malformada', '01-11-2026 9:55', [{ ...applied, time: '9:55' }]],
    ['la fila es de otro día', '31-10-2026 11:55', [applied]],
    [
      'el alta registrada es posterior al ingreso',
      '01-11-2026 21:30',
      [{ ...applied, time: '21:30' }],
    ],
  ])('pide revisión si %s', (_case, fechaEgreso, discharges) => {
    const result = selectEligibleEgresoRows(
      emptyDiff(),
      [row(fechaEgreso)],
      readmission(discharges)
    );
    // Nunca se descarta en silencio: se vincula a la cama o queda como revisión.
    expect(result.rows.length + result.diff.conflicts.length).toBe(1);
  });
});
