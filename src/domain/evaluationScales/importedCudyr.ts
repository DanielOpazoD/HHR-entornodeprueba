/**
 * Builds the imported CUDYR (CRD) result for a patient from Ficha Médico's nurse-list data. Rayen
 * only persists the composite category (e.g. "D3"), not the 14 individual variables, so this is all
 * that can be synced. Pure and testable.
 *
 * The CUDYR categorization is a DAILY assessment (per Daniel): the one recorded on 10-07 belongs to
 * the 10-07 census and must NOT carry over to the 11-07 census. So `crdDateTime` — resolved to its
 * Rapa Nui calendar day (Pacific/Easter, handles -06/-05 DST) — must EQUAL the census day being
 * synced. To fill a past day, sync while standing on that census day (the fill already asks with the
 * census date). "S/C" (sin categorizar) and blanks yield null.
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
 * The imported CUDYR result if (and only if) the patient was categorized ON `censusIsoDay`
 * (Rapa Nui). Daily assessment: it never carries over to other days.
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
