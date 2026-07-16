/**
 * Builds the daily imported CUDYR (CRD) result. Gestión de Camas is preferred because it exposes
 * the official history, author and 14-item breakdown; Ficha Médico supplies a latest-value fallback.
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

/** Provenance label shown for the preferred official source. */
export const CUDYR_IMPORT_SOURCE = 'Eloísa · Gestión de Camas';
export const CUDYR_FALLBACK_SOURCE = 'Eloísa · Ficha Médico';

export interface CudyrHistoryInput {
  category: string;
  recordedAt: string;
  author?: string;
  authorRole?: string;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: Array<{ fieldId: string; label: string; typeId: number; value: string }>;
}

export interface CudyrCategoryInput {
  /** Composite category as reported by Ficha Médico, e.g. "D3" (or "S/C" when not categorized). */
  crdValue: string;
  /** When it was categorized, ISO instant with offset, e.g. "2026-07-10T23:12:04.74+00:00". */
  crdDateTime: string;
  author?: string;
  authorRole?: string;
  source?: 'gestion_camas' | 'ficha_medico';
  history?: CudyrHistoryInput[];
}

/**
 * The imported CUDYR result if (and only if) the patient was categorized ON `censusIsoDay`
 * (Rapa Nui). Daily assessment: it never carries over to other days.
 */
export const buildImportedCudyr = (
  input: CudyrCategoryInput,
  censusIsoDay: string
): ImportedCudyr | null => {
  const fallback: CudyrHistoryInput = {
    category: input.crdValue,
    recordedAt: input.crdDateTime,
    author: input.author,
    authorRole: input.authorRole,
  };
  const candidates = (input.history?.length ? input.history : [fallback])
    .map(entry => {
      const category = (entry.category ?? '').trim();
      const epoch = Date.parse(entry.recordedAt ?? '');
      if (!category || /^s\/?c$/i.test(category) || Number.isNaN(epoch)) return null;
      return {
        ...entry,
        category,
        epoch,
        recordedDate: rapaNuiDayFormatter.format(new Date(epoch)),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.epoch - a.epoch);
  const selected = candidates.find(entry => entry.recordedDate === censusIsoDay);
  if (!selected) return null;
  const history = candidates
    .filter(entry => entry.recordedDate <= censusIsoDay)
    .map(({ epoch: _epoch, ...entry }) => entry);
  return {
    category: selected.category,
    recordedDate: selected.recordedDate,
    recordedAt: selected.recordedAt,
    author: selected.author,
    authorRole: selected.authorRole,
    dependencyScore: selected.dependencyScore,
    riskScore: selected.riskScore,
    items: selected.items,
    history,
    source: input.source === 'gestion_camas' ? CUDYR_IMPORT_SOURCE : CUDYR_FALLBACK_SOURCE,
  };
};
