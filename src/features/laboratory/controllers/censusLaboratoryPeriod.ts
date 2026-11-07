import type { CensusLabDateRange } from '@/shared/contracts/censusLaboratory';
import { parseCalendarDateUtcNoon } from '@/utils/clinicalDateUtils';

export interface CensusLaboratoryPeriodDraft extends CensusLabDateRange {
  mode: 'admission' | 'custom';
}

const validDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = parseCalendarDateUtcNoon(value);
  if (stamp === null) return false;
  // A calendar day parsed at UTC noon; compare its components, never a clinical instant.
  const day = new Date(stamp);
  return (
    `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}` ===
    value
  );
};

export const censusLaboratoryPeriodProblem = (
  range: CensusLabDateRange,
  today: string
): string | null => {
  if (!validDay(range.from) || !validDay(range.to)) return 'Elige fechas válidas en Desde y Hasta.';
  if (range.from > range.to) return 'Desde debe ser anterior o igual a Hasta.';
  if (range.to > today) return 'Hasta no puede ser posterior a hoy en Rapa Nui.';
  return null;
};

export const censusLaboratoryDraftRange = (
  draft: CensusLaboratoryPeriodDraft
): CensusLabDateRange | undefined =>
  draft.mode === 'custom' ? { from: draft.from, to: draft.to } : undefined;
