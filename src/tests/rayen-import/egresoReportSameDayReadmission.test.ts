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
  const applied = { rut: '11.111.111-1', clinicalEpisodeId: 'synthetic-old', time: '11:55' };

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
    ['el alta es posterior al ingreso activo', '01-11-2026 21:00', [applied]],
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
