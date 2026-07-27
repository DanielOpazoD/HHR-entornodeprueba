/**
 * Union of the risk scales read from Ficha Médico's TWO sources, because NEITHER is complete:
 *  - the clinical-history report (`parseHistoryScales`) carries real `publishDatetime`s and resolves
 *    archived/superseded records, but for some patients it MISSES scales that were applied, and
 *  - the "Resumen → Instrumentos de evaluación" table (`encounterFormEntry` → `parseEvaluationScales`)
 *    shows exactly those missing scales, but with less reliable dates.
 * (Confirmed by Daniel: e.g. Rodrigo Cadet H3C1 — his Braden shows in the summary table yet is absent
 * from the history report, so a history-only sync had no record of it.)
 *
 * ARCHIVED RULE. Archived records remain clinically usable. Day-level selection later prefers the
 * newest visible application, falling back to the newest archived application when all are hidden.
 *
 * Strategy: normalize every ordering key, then reconcile ONE-TO-ONE only exact cross-source copies
 * `(code · timestamp · total · severity)`. Without a stable shared source identifier, fuzzy matching
 * can erase a genuine repeat. Ambiguous time differences therefore remain as separate applications.
 * History contributes reliable attribution; summary contributes the fuller item breakdown.
 */

import type { EvaluationScale } from './parseEvaluationScales';

/** Rewrite `encounterEventId` to YYYYMMDDHHMMSS; `sourceOrder` stays the independent tie-breaker. */
const normalize = (scale: EvaluationScale): EvaluationScale => {
  const day = scale.recordedDate.replace(/-/g, ''); // YYYYMMDD
  if (!/^\d{8}$/.test(day)) return scale;
  const time = canonicalClock(scale.recordedAt);
  // Preserve the parser's application-index fallback when Rayen supplies a day but no clock.
  if (!time) return scale;
  const hhmmss = time.replace(/:/g, '');
  const key = Number(`${day}${hhmmss}`);
  return Number.isSafeInteger(key) && key > 0 ? { ...scale, encounterEventId: key } : scale;
};

/** Canonical HH:MM:SS clock; Rayen sometimes omits seconds or a leading zero. */
const canonicalClock = (recordedAt: string): string | null => {
  const time = recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return [hour, minute, second].map(value => String(value).padStart(2, '0')).join(':');
};

const exactApplicationKey = (scale: EvaluationScale, source: 'history' | 'summary'): string =>
  [
    scale.code,
    scale.recordedDate,
    canonicalClock(scale.recordedAt) ??
      // Without a clock there is no safe cross-source identity: keep each source record distinct.
      `${source}:${scale.encounterEventId}:${scale.sourceOrder ?? ''}`,
    scale.total ?? '',
  ].join('|');

const severitiesAreCompatible = (left: EvaluationScale, right: EvaluationScale): boolean =>
  left.severity == null || right.severity == null || left.severity === right.severity;

const mergeDuplicate = (history: EvaluationScale, summary: EvaluationScale): EvaluationScale => {
  const preferred = history.archived && !summary.archived ? summary : history;
  const complement = preferred === history ? summary : history;
  const richerItems =
    preferred.items.length >= complement.items.length ? preferred.items : complement.items;
  return {
    ...preferred,
    items: richerItems,
    severity: preferred.severity ?? complement.severity,
    // Historial is authoritative for who applied it, regardless of quick-summary archive state.
    author: history.author || summary.author,
    authorRole: history.authorRole || summary.authorRole,
    archived: Boolean(preferred.archived && complement.archived),
  };
};

/**
 * Union the two scale sources while retaining every distinct application — see the file header.
 */
export const mergeScaleSources = (
  historyScales: EvaluationScale[],
  summaryScales: EvaluationScale[]
): EvaluationScale[] => {
  const groups = new Map<string, { history: EvaluationScale[]; summary: EvaluationScale[] }>();
  const add = (source: 'history' | 'summary', scale: EvaluationScale) => {
    const normalized = normalize(scale);
    const key = exactApplicationKey(normalized, source);
    const group = groups.get(key) ?? { history: [], summary: [] };
    group[source].push(normalized);
    groups.set(key, group);
  };
  historyScales.forEach(scale => add('history', scale));
  summaryScales.forEach(scale => add('summary', scale));

  const merged: EvaluationScale[] = [];
  for (const group of groups.values()) {
    const unmatchedSummary = [...group.summary];
    for (const history of group.history) {
      // Prefer an equal non-null severity. A missing severity may enrich its exact copy, but two
      // contradictory clinical classifications must remain as distinct applications.
      let summaryIndex = unmatchedSummary.findIndex(
        summary => history.severity != null && summary.severity === history.severity
      );
      if (summaryIndex < 0)
        summaryIndex = unmatchedSummary.findIndex(summary =>
          severitiesAreCompatible(history, summary)
        );
      if (summaryIndex < 0) {
        merged.push(history);
        continue;
      }
      const [summary] = unmatchedSummary.splice(summaryIndex, 1);
      merged.push(mergeDuplicate(history, summary));
    }
    merged.push(...unmatchedSummary);
  }
  return merged;
};
