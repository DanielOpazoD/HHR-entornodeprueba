import { describe, expect, it } from 'vitest';
import {
  applyEgresoReport,
  requiresReview,
  type CensusImportDiff,
  type EgresoReportRow,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const makeRecord = (): DailyRecord => ({
  date: '2026-07-14',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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
  ...over,
});

const reportRow = (bedLabel: string): EgresoReportRow => ({
  run: '11.044.046-4',
  patientName: 'Paciente recuperación',
  bedLabel,
  servicio: 'Recuperación Pabellón',
  edad: '',
  destino: 'Domicilio',
  motivo: '',
  fechaEgreso: '14-07-2026 12:00',
});

const patient = (bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: 'Paciente existente',
  rut: '18.384.545-4',
});

describe('administrative egreso pavilion recovery policy', () => {
  it.each(['P-R1', 'Pabellón-R2'])(
    'omits administrative movements from pavilion recovery position %s',
    bedLabel => {
      const enriched = applyEgresoReport(makeDiff(), [reportRow(bedLabel)], makeRecord());

      expect(enriched.discharges).toEqual([]);
      expect(enriched.reportEgresos ?? []).toEqual([]);
      expect(enriched.conflicts).toEqual([]);
      expect(requiresReview(enriched)).toBe(false);
    }
  );

  it.each(['P-R1', 'Pabellón-R2'])(
    'preserves an existing diff when pavilion recovery position %s is the only report row',
    bedLabel => {
      const admissionPatient = patient('H1C1');
      const updatedPatient = patient('R4');
      const existingDiff = makeDiff({
        admissions: [
          { bedId: 'H1C1', patient: admissionPatient, isCma: false, source: {} as never },
        ],
        updates: [
          {
            bedId: 'R4',
            rut: updatedPatient.rut,
            patientName: updatedPatient.patientName,
            changes: [],
            patient: updatedPatient,
            source: {} as never,
          },
        ],
        conflicts: [
          {
            bedId: 'H2C1',
            patientName: 'Paciente en revisión',
            reason: 'Conflicto existente',
          },
        ],
      });

      const enriched = applyEgresoReport(existingDiff, [reportRow(bedLabel)], makeRecord());

      expect(enriched.admissions).toEqual(existingDiff.admissions);
      expect(enriched.updates).toEqual(existingDiff.updates);
      expect(enriched.conflicts).toEqual(existingDiff.conflicts);
      expect(enriched.discharges).toEqual([]);
      expect(enriched.reportEgresos ?? []).toEqual([]);
      expect(requiresReview(enriched)).toBe(true);
    }
  );
});
