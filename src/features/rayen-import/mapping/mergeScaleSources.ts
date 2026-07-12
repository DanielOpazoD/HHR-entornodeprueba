/**
 * Union of the risk scales read from Ficha Médico's TWO sources, because NEITHER is complete:
 *  - the clinical-history report (`parseHistoryScales`) carries real `publishDatetime`s and resolves
 *    archived/superseded records, but for some patients it MISSES scales that were applied, and
 *  - the "Resumen → Instrumentos de evaluación" table (`encounterFormEntry` → `parseEvaluationScales`)
 *    shows exactly those missing scales, but with less reliable dates.
 * (Confirmed by Daniel: e.g. Rodrigo Cadet H3C1 — his Braden shows in the summary table yet is absent
 * from the history report, so a history-only sync had no record of it.)
 *
 * ARCHIVED RULE (across sources). A LIVE (non-archived) record ALWAYS wins over an archived one on the
 * SAME day, even if the archived one is newer — being archived removes its priority. An archived record
 * is kept ONLY when it is the day's sole measurement of that scale. The catch: the archived flag lives
 * in the history report while the live version often lives only in the summary table, so the resolution
 * must run AFTER the union (per code · day), not inside either parser.
 *
 * Strategy: union both sources (summary FIRST — it is the authoritative view of the current valid
 * scales, so it wins dedupe ties). Drop archived records whose (code · day) has any live record from
 * either source. Dedupe the rest by (code · day · total · severity). Finally normalize every ordering
 * key to a `YYYYMMDDHHMMSS` timestamp (from `recordedDate` + the time in `recordedAt`) so the two
 * sources' different id schemes never break the "last of the day" / as-of selection downstream.
 */

import type { EvaluationScale } from './parseEvaluationScales';

const dedupeKey = (scale: EvaluationScale): string =>
  `${scale.code}|${scale.recordedDate}|${scale.total ?? ''}|${scale.severity ?? ''}`;

const codeDay = (scale: EvaluationScale): string => `${scale.code}|${scale.recordedDate}`;

/** Rewrite `encounterEventId` to a monotonic YYYYMMDDHHMMSS from the scale's own day + time, dropping
 * the internal `archived` flag from the public result. */
const normalize = (scale: EvaluationScale): EvaluationScale => {
  const { archived: _archived, ...clean } = scale;
  const day = clean.recordedDate.replace(/-/g, ''); // YYYYMMDD
  if (!/^\d{8}$/.test(day)) return clean;
  const time = clean.recordedAt.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  const hhmmss = time ? `${time[1].padStart(2, '0')}${time[2]}${time[3]}` : '000000';
  const key = Number(`${day}${hhmmss}`);
  return Number.isSafeInteger(key) && key > 0 ? { ...clean, encounterEventId: key } : clean;
};

/**
 * Union of the two scale sources with the cross-source archived rule applied — see the file header.
 * Summary scales come first so they win dedupe ties (the summary is the authoritative "valid scales"
 * view); archived history records are dropped when the same code·day has a live record anywhere.
 */
export const mergeScaleSources = (
  historyScales: EvaluationScale[],
  summaryScales: EvaluationScale[]
): EvaluationScale[] => {
  const all = [...summaryScales, ...historyScales];

  // Every (code · day) that has at least one LIVE (non-archived) measurement, across both sources.
  const daysWithLiveScore = new Set<string>();
  for (const scale of all) if (!scale.archived) daysWithLiveScore.add(codeDay(scale));

  const merged = new Map<string, EvaluationScale>();
  for (const scale of all) {
    if (scale.archived && daysWithLiveScore.has(codeDay(scale))) continue; // live wins that day
    const key = dedupeKey(scale);
    if (!merged.has(key)) merged.set(key, scale); // summary-first → summary wins ties
  }
  return [...merged.values()].map(normalize);
};
