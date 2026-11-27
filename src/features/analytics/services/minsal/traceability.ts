import {
  MinsalCalculationOptions,
  PatientTraceability,
  SpecialtyTraceabilityType,
} from '@/features/analytics/types/minsalTypes';
import type { DailyRecordMovementState as MinsalDailyRecord } from '@/types/domain/dailyRecordSlices';
import { calculateMinsalStats } from './calculator';
import { normalizeSpecialty } from './normalization';

/**
 * Build traceability list lazily for a specialty + indicator type using the
 * canonical MINSAL calculator so fallback reconstruction never diverges from
 * precomputed specialty lists.
 */
export function buildSpecialtyTraceability(
  records: MinsalDailyRecord[],
  specialty: string,
  type: SpecialtyTraceabilityType,
  options: MinsalCalculationOptions = {}
): PatientTraceability[] {
  if (records.length === 0) return [];

  const orderedDates = records.map(record => record.date).sort((a, b) => a.localeCompare(b));
  const startDate = orderedDates[0];
  const endDate = orderedDates[orderedDates.length - 1];
  if (!startDate || !endDate) return [];
  const stats = calculateMinsalStats(records, startDate, endDate, options);
  const normalizedSpecialty = normalizeSpecialty(specialty);

  if (type === 'cma') {
    const cmaRow = stats.cma?.porEspecialidad.find(
      item => normalizeSpecialty(String(item.specialty)) === normalizedSpecialty
    );
    return cmaRow?.pacientesList ?? [];
  }

  const specialtyRow = stats.porEspecialidad.find(
    item => normalizeSpecialty(String(item.specialty)) === normalizedSpecialty
  );
  if (!specialtyRow) return [];

  switch (type) {
    case 'dias-cama':
      return specialtyRow.diasOcupadosList ?? [];
    case 'egresos':
    case 'estada':
      return specialtyRow.egresosList ?? [];
    case 'fallecidos':
      return specialtyRow.fallecidosList ?? [];
    case 'traslados':
      return specialtyRow.trasladosList ?? [];
    case 'aerocardal':
      return specialtyRow.aerocardalList ?? [];
    case 'fach':
      return specialtyRow.fachList ?? [];
  }
}
