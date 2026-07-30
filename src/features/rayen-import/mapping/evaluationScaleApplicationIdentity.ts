import type { EvaluationScale } from './parseEvaluationScales';

const itemsOf = (scale: EvaluationScale) => scale.items ?? [];

export interface ParsedClock {
  seconds: number;
  hasSeconds: boolean;
}

export const parseClock = (recordedAt: string): ParsedClock | null => {
  const match = recordedAt.match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return {
    seconds: hour * 3600 + minute * 60 + second,
    hasSeconds: match[3] != null,
  };
};

const itemAnswers = (scale: EvaluationScale): Map<string, string> =>
  new Map(itemsOf(scale).map(item => [item.id, JSON.stringify([item.value, item.valueName])]));

const itemMatchQuality = (
  left: EvaluationScale,
  right: EvaluationScale,
  allowPartialPayload: boolean
): number | null => {
  const leftAnswers = itemAnswers(left);
  const rightAnswers = itemAnswers(right);
  if (leftAnswers.size === 0 || rightAnswers.size === 0) {
    return allowPartialPayload || leftAnswers.size === rightAnswers.size ? 0 : null;
  }
  if (!allowPartialPayload && leftAnswers.size !== rightAnswers.size) return null;
  const [smaller, larger] =
    leftAnswers.size <= rightAnswers.size
      ? [leftAnswers, rightAnswers]
      : [rightAnswers, leftAnswers];
  for (const [id, answer] of smaller) {
    if (larger.get(id) !== answer) return null;
  }
  return leftAnswers.size === rightAnswers.size ? 2 : 1;
};

const clockMatchQuality = (
  left: ParsedClock,
  right: ParsedClock,
  allowMinutePrecision: boolean
): number | null => {
  if (!left.hasSeconds && !right.hasSeconds) {
    return left.seconds === right.seconds ? 1 : null;
  }
  if (!left.hasSeconds || !right.hasSeconds) {
    return allowMinutePrecision && Math.floor(left.seconds / 60) === Math.floor(right.seconds / 60)
      ? 0
      : null;
  }
  return left.seconds === right.seconds ? 1 : null;
};

export interface ScaleEquivalenceOptions {
  /** Only for Historial ↔ Resumen pairing: Resumen legitimately omits seconds. */
  allowMinutePrecision?: boolean;
  /** Only across known representations of one event; never for same-source duplicate removal. */
  allowPartialPayload?: boolean;
}

/**
 * Clinical identity for one application, independent of the outer form and its attributed author.
 * Rayen can expose the same answers in multiple repeated forms, occasionally a few seconds apart.
 */
export const scaleApplicationMatchQuality = (
  left: EvaluationScale,
  right: EvaluationScale,
  options: ScaleEquivalenceOptions = {}
): number | null => {
  if (
    left.code !== right.code ||
    left.recordedDate !== right.recordedDate ||
    left.total !== right.total ||
    (!options.allowPartialPayload && left.severity !== right.severity) ||
    (left.severity != null && right.severity != null && left.severity !== right.severity)
  ) {
    return null;
  }

  // Within one source/persisted history, the normalized event timestamp is the canonical
  // application identity. `sourceOrder` identifies the surrounding Rayen form and may differ for
  // duplicate representations. Cross-source minute matching is the one deliberate exception.
  if (
    options.allowMinutePrecision !== true &&
    left.encounterEventId > 0 &&
    right.encounterEventId > 0 &&
    left.encounterEventId !== right.encounterEventId
  ) {
    return null;
  }

  const itemsQuality = itemMatchQuality(left, right, options.allowPartialPayload === true);
  if (itemsQuality == null) return null;

  const leftClock = parseClock(left.recordedAt);
  const rightClock = parseClock(right.recordedAt);
  if (leftClock == null || rightClock == null) return null;
  // Minute-only timestamps cannot prove that two same-source forms are one application. Preserve
  // their multiplicity when Rayen supplies distinct form ordering identities. Cross-source pairing
  // remains intentionally tolerant because Resumen routinely omits Historial's seconds.
  if (
    options.allowMinutePrecision !== true &&
    !leftClock.hasSeconds &&
    !rightClock.hasSeconds &&
    left.sourceOrder != null &&
    right.sourceOrder != null &&
    left.sourceOrder !== right.sourceOrder
  ) {
    return null;
  }
  const clockQuality = clockMatchQuality(
    leftClock,
    rightClock,
    options.allowMinutePrecision === true
  );
  if (clockQuality == null) return null;

  const severityQuality = left.severity != null && right.severity != null ? 1 : 0;
  return severityQuality * 10 + itemsQuality * 2 + clockQuality;
};

export const areEquivalentScaleApplications = (
  left: EvaluationScale,
  right: EvaluationScale,
  options: ScaleEquivalenceOptions = {}
): boolean => scaleApplicationMatchQuality(left, right, options) != null;

const preferredEquivalent = (left: EvaluationScale, right: EvaluationScale): EvaluationScale => {
  if (Boolean(left.archived) !== Boolean(right.archived)) return left.archived ? right : left;
  const leftItems = itemsOf(left);
  const rightItems = itemsOf(right);
  if (leftItems.length !== rightItems.length)
    return leftItems.length > rightItems.length ? left : right;
  if (
    (left.sourceOrder ?? Number.MAX_SAFE_INTEGER) !== (right.sourceOrder ?? Number.MAX_SAFE_INTEGER)
  )
    return (left.sourceOrder ?? Number.MAX_SAFE_INTEGER) <
      (right.sourceOrder ?? Number.MAX_SAFE_INTEGER)
      ? left
      : right;
  return left;
};

/** Collapse copies from one source while preserving the best available clinical payload. */
export const mergeEquivalentScaleApplications = (
  left: EvaluationScale,
  right: EvaluationScale
): EvaluationScale => {
  const preferred = preferredEquivalent(left, right);
  const complement = preferred === left ? right : left;
  const stableRepresentation =
    preferred.encounterEventId > 0
      ? preferred
      : complement.encounterEventId > 0
        ? complement
        : null;
  const preferredItems = itemsOf(preferred);
  const complementItems = itemsOf(complement);
  const merged: EvaluationScale = {
    ...preferred,
    ...(stableRepresentation
      ? {
          encounterEventId: stableRepresentation.encounterEventId,
          ...(stableRepresentation.sourceOrder != null
            ? { sourceOrder: stableRepresentation.sourceOrder }
            : {}),
        }
      : {}),
    items: preferredItems.length >= complementItems.length ? preferredItems : complementItems,
    severity: preferred.severity ?? complement.severity,
    author: preferred.author || complement.author,
    authorRole: preferred.authorRole || complement.authorRole,
  };
  // `archived` is an affirmative flag in the persisted contract. Omit it for a visible
  // representation instead of materializing `false`, which keeps old snapshots stable and avoids
  // a write that carries no clinical change.
  if (preferred.archived && complement.archived) merged.archived = true;
  else delete merged.archived;
  return merged;
};

export const dedupeEquivalentScaleApplications = (
  scales: EvaluationScale[],
  options: ScaleEquivalenceOptions = {}
): EvaluationScale[] => {
  const deduped: EvaluationScale[] = [];
  for (const scale of scales) {
    const duplicateIndex = deduped.findIndex(candidate =>
      areEquivalentScaleApplications(candidate, scale, options)
    );
    if (duplicateIndex < 0) deduped.push(scale);
    else deduped[duplicateIndex] = mergeEquivalentScaleApplications(deduped[duplicateIndex], scale);
  }
  return deduped;
};
