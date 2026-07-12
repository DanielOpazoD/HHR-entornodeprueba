/**
 * Union of the risk scales read from Ficha Médico's TWO sources, because NEITHER is complete:
 *  - the clinical-history report (`parseHistoryScales`) carries real `publishDatetime`s and resolves
 *    archived/superseded records, but for some patients it MISSES scales that were applied, and
 *  - the "Resumen → Instrumentos de evaluación" table (`encounterFormEntry` → `parseEvaluationScales`)
 *    shows exactly those missing scales, but with less reliable dates.
 * (Confirmed by Daniel: e.g. Rodrigo Cadet H3C1 — his Braden shows in the summary table yet is absent
 * from the history report, so a history-only sync had no record of it.)
 *
 * Strategy: keep every distinct scale from both sources. A scale present in BOTH is deduped by
 * (code · day · total · severity), preferring the HISTORY copy (real date + archived-resolved). The
 * ordering key (`encounterEventId`) of every surviving scale is normalized to a `YYYYMMDDHHMMSS`
 * timestamp — derived from its own `recordedDate` + the time in `recordedAt` — so the two sources'
 * different id schemes never break the "last of the day" / as-of selection downstream.
 */

import type { EvaluationScale } from './parseEvaluationScales';

const dedupeKey = (scale: EvaluationScale): string =>
  `${scale.code}|${scale.recordedDate}|${scale.total ?? ''}|${scale.severity ?? ''}`;

/** Rewrite `encounterEventId` to a monotonic YYYYMMDDHHMMSS from the scale's own day + time. */
const withTimestampOrder = (scale: EvaluationScale): EvaluationScale => {
  const day = scale.recordedDate.replace(/-/g, ''); // YYYYMMDD
  if (!/^\d{8}$/.test(day)) return scale;
  const time = scale.recordedAt.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  const hhmmss = time ? `${time[1].padStart(2, '0')}${time[2]}${time[3]}` : '000000';
  const key = Number(`${day}${hhmmss}`);
  return Number.isSafeInteger(key) && key > 0 ? { ...scale, encounterEventId: key } : scale;
};

/**
 * Merge history-report scales with summary (`encounterFormEntry`) scales into one deduped list, then
 * normalize the ordering keys. History wins on a dedupe collision; summary-only scales are added.
 */
export const mergeScaleSources = (
  historyScales: EvaluationScale[],
  summaryScales: EvaluationScale[]
): EvaluationScale[] => {
  const merged = new Map<string, EvaluationScale>();
  for (const scale of historyScales) merged.set(dedupeKey(scale), scale);
  for (const scale of summaryScales) {
    const key = dedupeKey(scale);
    if (!merged.has(key)) merged.set(key, scale);
  }
  return [...merged.values()].map(withTimestampOrder);
};
