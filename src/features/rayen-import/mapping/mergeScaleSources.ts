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
 * Strategy: normalize every ordering key, collapse equivalent copies inside each source, then
 * reconcile ONE-TO-ONE cross-source copies by clinical identity. Resumen sometimes omits seconds
 * and repeated forms can expose the same answers a few seconds apart. Distinct results and genuine
 * repeated applications remain independent.
 * History contributes reliable attribution; summary contributes the fuller item breakdown.
 */

import type { EvaluationScale } from './parseEvaluationScales';
import {
  dedupeEquivalentScaleApplications,
  mergeEquivalentScaleApplications,
  parseClock,
  scaleApplicationMatchQuality,
} from './evaluationScaleApplicationIdentity';

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
  const parsed = parseClock(recordedAt);
  if (!parsed) return null;
  const hour = Math.floor(parsed.seconds / 3600);
  const minute = Math.floor((parsed.seconds % 3600) / 60);
  const second = parsed.seconds % 60;
  return [hour, minute, second].map(value => String(value).padStart(2, '0')).join(':');
};

const mergeDuplicate = (history: EvaluationScale, summary: EvaluationScale): EvaluationScale => {
  const merged = mergeEquivalentScaleApplications(history, summary);
  const withHistoryIdentity: EvaluationScale = {
    ...merged,
    recordedDate: history.recordedDate,
    recordedAt: history.recordedAt,
    encounterEventId: history.encounterEventId,
    // Historial is authoritative for who applied it, regardless of quick-summary archive state.
    author: history.author || summary.author,
    authorRole: history.authorRole || summary.authorRole,
  };
  if (history.sourceOrder != null) withHistoryIdentity.sourceOrder = history.sourceOrder;
  else delete withHistoryIdentity.sourceOrder;
  // When both authoritative sources expose one application, Resumen owns its current quick-display
  // state. Single-source results never enter this branch and retain that source's archive state.
  if (summary.archived) withHistoryIdentity.archived = true;
  else delete withHistoryIdentity.archived;
  return withHistoryIdentity;
};

interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
}

const addFlowEdge = (graph: FlowEdge[][], from: number, to: number, cost: number): FlowEdge => {
  const forward: FlowEdge = { to, reverse: graph[to].length, capacity: 1, cost };
  const backward: FlowEdge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
  graph[from].push(forward);
  graph[to].push(backward);
  return forward;
};

const matchSummaryApplications = (
  history: EvaluationScale[],
  summary: EvaluationScale[]
): Map<number, number> => {
  const source = 0;
  const historyOffset = 1;
  const summaryOffset = historyOffset + history.length;
  const sink = summaryOffset + summary.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const pairEdges: Array<{
    historyIndex: number;
    summaryIndex: number;
    edge: FlowEdge;
  }> = [];

  history.forEach((historyScale, historyIndex) => {
    addFlowEdge(graph, source, historyOffset + historyIndex, 0);
    summary.forEach((summaryScale, summaryIndex) => {
      const quality = scaleApplicationMatchQuality(historyScale, summaryScale, {
        allowMinutePrecision: true,
        allowPartialPayload: true,
      });
      if (quality == null) return;
      pairEdges.push({
        historyIndex,
        summaryIndex,
        edge: addFlowEdge(
          graph,
          historyOffset + historyIndex,
          summaryOffset + summaryIndex,
          -quality
        ),
      });
    });
  });
  summary.forEach((_, summaryIndex) => addFlowEdge(graph, summaryOffset + summaryIndex, sink, 0));

  const maxAugmentations = Math.min(history.length, summary.length);
  for (let augmentation = 0; augmentation < maxAugmentations; augmentation += 1) {
    const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previous = Array<{ node: number; edge: number } | null>(graph.length).fill(null);
    distance[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      graph.forEach((edges, node) => {
        if (!Number.isFinite(distance[node])) return;
        edges.forEach((edge, edgeIndex) => {
          const nextDistance = distance[node] + edge.cost;
          if (edge.capacity > 0 && nextDistance < distance[edge.to]) {
            distance[edge.to] = nextDistance;
            previous[edge.to] = { node, edge: edgeIndex };
            changed = true;
          }
        });
      });
      if (!changed) break;
    }
    if (previous[sink] == null) break;
    const path: Array<{ node: number; step: { node: number; edge: number } }> = [];
    const visited = new Set<number>();
    let node = sink;
    while (node !== source) {
      const step = previous[node];
      if (!step || visited.has(node)) break;
      visited.add(node);
      path.push({ node, step });
      node = step.node;
    }
    // A malformed predecessor chain is an internal invariant failure. Preserve earlier complete
    // matches and stop without partially mutating this path.
    if (node !== source) break;
    for (const { node: pathNode, step } of path) {
      const edge = graph[step.node][step.edge];
      edge.capacity -= 1;
      graph[pathNode][edge.reverse].capacity += 1;
    }
  }

  return new Map(
    pairEdges
      .filter(({ edge }) => edge.capacity === 0)
      .map(({ historyIndex, summaryIndex }) => [historyIndex, summaryIndex])
  );
};

/**
 * Union the two scale sources while retaining every distinct application — see the file header.
 */
export const mergeScaleSources = (
  historyScales: EvaluationScale[],
  summaryScales: EvaluationScale[]
): EvaluationScale[] => {
  const history = dedupeEquivalentScaleApplications(historyScales.map(normalize));
  const unmatchedSummary = dedupeEquivalentScaleApplications(summaryScales.map(normalize));
  const summaryByHistory = matchSummaryApplications(history, unmatchedSummary);
  const matchedSummary = new Set(summaryByHistory.values());

  const merged: EvaluationScale[] = [];
  history.forEach((historyScale, historyIndex) => {
    const summaryIndex = summaryByHistory.get(historyIndex);
    merged.push(
      summaryIndex == null
        ? historyScale
        : mergeDuplicate(historyScale, unmatchedSummary[summaryIndex])
    );
  });
  unmatchedSummary.forEach((summaryScale, summaryIndex) => {
    if (!matchedSummary.has(summaryIndex)) merged.push(summaryScale);
  });
  return merged;
};
