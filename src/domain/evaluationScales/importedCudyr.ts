/**
 * Builds the imported CUDYR (CRD) result for a patient from Ficha Médico's nurse-list data. Rayen
 * only persists the composite category (e.g. "D3"), not the 14 individual variables, so this is all
 * that can be synced. Pure and testable.
 *
 * Only the categorization of the CENSUS DAY is taken (per Daniel): `crdDateTime` is resolved to its
 * Rapa Nui calendar day (Pacific/Easter, handles -06/-05 DST) and must equal the census day. "S/C"
 * (sin categorizar) and blanks yield null.
 */

import type { ImportedCudyr } from '@/types/domain/evaluationScores';

const RAPA_NUI_TZ = 'Pacific/Easter';
const rapaNuiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RAPA_NUI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Provenance label shown wherever the imported CUDYR appears. */
export const CUDYR_IMPORT_SOURCE = 'Eloísa (Rayen)';

export interface CudyrCategoryInput {
  /** Composite category as reported by Ficha Médico, e.g. "D3" (or "S/C" when not categorized). */
  crdValue: string;
  /** When it was categorized, ISO instant with offset, e.g. "2026-07-10T23:12:04.74+00:00". */
  crdDateTime: string;
}

/**
 * The imported CUDYR result if the patient was categorized ON `censusIsoDay` (Rapa Nui); null when
 * there is no real category or it belongs to another day.
 */
export const buildImportedCudyr = (
  input: CudyrCategoryInput,
  censusIsoDay: string
): ImportedCudyr | null => {
  const category = (input.crdValue ?? '').trim();
  if (!category || /^s\/?c$/i.test(category)) return null;

  const epoch = Date.parse(input.crdDateTime ?? '');
  if (Number.isNaN(epoch)) return null;

  const recordedDate = rapaNuiDayFormatter.format(new Date(epoch));
  if (recordedDate !== censusIsoDay) return null;

  return { category, recordedDate, source: CUDYR_IMPORT_SOURCE };
};
