/**
 * Builds the daily imported CUDYR (CRD) result. Gestión de Camas is preferred because it exposes
 * the official history, author and 14-item breakdown; Ficha Médico supplies a latest-value fallback.
 *
 * The CUDYR categorization belongs to the night shift that started on the census day. A result
 * recorded in Rapa Nui between 00:01 and 11:59 on D + 1 therefore belongs to census D. The moment
 * when HHR later synchronizes the result never changes that owning date. "S/C" (sin categorizar)
 * and blanks yield null.
 */

import type { ImportedCudyr } from '@/types/domain/evaluationScores';

const RAPA_NUI_TZ = 'Pacific/Easter';
const rapaNuiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RAPA_NUI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const rapaNuiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RAPA_NUI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const previousCensusIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
};

/** Resolves the census/night-shift date that owns an official CUDYR application. */
export const resolveCudyrOwningCensusDay = (recordedAt: string): string | null => {
  const epoch = Date.parse(recordedAt);
  if (Number.isNaN(epoch)) return null;
  const instant = new Date(epoch);
  const parts = Object.fromEntries(
    rapaNuiDateTimeFormatter
      .formatToParts(instant)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  const recordedDate = rapaNuiDayFormatter.format(instant);
  const secondsAfterMidnight =
    Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return secondsAfterMidnight >= 60 && secondsAfterMidnight < 12 * 3600
    ? previousCensusIsoDay(recordedDate)
    : recordedDate;
};

/**
 * Checks ownership from the source timestamp whenever it is available. This also repairs the
 * interpretation of legacy snapshots whose `recordedDate` stored the calendar application day
 * instead of the night-shift census day.
 */
export const importedCudyrBelongsToCensus = (
  cudyr: Partial<Pick<ImportedCudyr, 'recordedDate' | 'recordedAt'>> | null | undefined,
  censusIsoDay: string
): boolean => {
  if (!cudyr) return false;
  const owningDay = cudyr.recordedAt ? resolveCudyrOwningCensusDay(cudyr.recordedAt) : null;
  return (owningDay ?? cudyr.recordedDate ?? null) === censusIsoDay;
};

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
 * The imported CUDYR result if (and only if) its owning night shift matches `censusIsoDay`.
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
      if (!/^[A-D][1-3]$/i.test(category) || Number.isNaN(epoch)) return null;
      const owningCensusDate = resolveCudyrOwningCensusDay(entry.recordedAt);
      if (!owningCensusDate) return null;
      return {
        ...entry,
        category: category.toUpperCase(),
        epoch,
        recordedDate: rapaNuiDayFormatter.format(new Date(epoch)),
        owningCensusDate,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.epoch - a.epoch);
  const selected = candidates.find(entry => entry.owningCensusDate === censusIsoDay);
  if (!selected) return null;
  const history = candidates
    .filter(entry => entry.owningCensusDate <= censusIsoDay)
    .map(({ epoch: _epoch, owningCensusDate: _owningCensusDate, ...entry }) => entry);
  return {
    category: selected.category,
    recordedDate: selected.owningCensusDate,
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
