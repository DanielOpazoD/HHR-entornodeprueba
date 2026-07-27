/** Raw field shape shared by the evaluation-scale and vital-sign parsers. */
export interface RawEvaluationCampo {
  id?: unknown;
  label?: unknown;
  value?: unknown;
  valueName?: unknown;
  sectionId?: unknown;
  createDatetime?: unknown;
}

const text = (value: unknown): string => (value == null ? '' : String(value)).trim();

const clinicalWallClock = (raw: string): number | null => {
  const match = raw.match(/^\s*(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T]+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (!match || match[4] == null) return null;
  const [, day, month, year, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
};

/**
 * `Repetir` can append another complete answer set to the same Rayen form. Split those fields into
 * applications using complete occurrence order first, then time and source proximity for optional
 * fields. This preserves repeated applications even when their timestamps are equal or incomplete.
 */
export const groupEvaluationScaleApplications = (
  campos: RawEvaluationCampo[]
): RawEvaluationCampo[][] => {
  const scoreAnchors = campos
    .map((campo, sourceIndex) => ({ campo, sourceIndex }))
    .filter(({ campo }) => text(campo.id).toUpperCase().endsWith('_PUNTAJE'))
    .map(({ campo, sourceIndex }) => ({
      sourceIndex,
      clock: clinicalWallClock(text(campo.createDatetime)),
    }));

  if (scoreAnchors.length <= 1) return [campos];

  const groups: RawEvaluationCampo[][] = Array.from({ length: scoreAnchors.length }, () => []);
  const occurrencesByField = new Map<string, number>();
  const fieldTotals = campos.reduce((totals, campo) => {
    const fieldId = text(campo.id);
    if (fieldId) totals.set(fieldId, (totals.get(fieldId) ?? 0) + 1);
    return totals;
  }, new Map<string, number>());
  const allAnchorsHaveClock = scoreAnchors.every(anchor => anchor.clock != null);

  campos.forEach((campo, sourceIndex) => {
    const fieldId = text(campo.id);
    const occurrence = occurrencesByField.get(fieldId) ?? 0;
    occurrencesByField.set(fieldId, occurrence + 1);
    const clock = clinicalWallClock(text(campo.createDatetime));

    let groupIndex = Math.min(occurrence, groups.length - 1);
    const hasCompleteOccurrenceMapping =
      fieldId !== '' && fieldTotals.get(fieldId) === scoreAnchors.length;
    if (!hasCompleteOccurrenceMapping && clock != null && allAnchorsHaveClock) {
      let nearestDistance = Number.POSITIVE_INFINITY;
      let nearestSourceDistance = Number.POSITIVE_INFINITY;
      scoreAnchors.forEach((anchor, anchorIndex) => {
        if (anchor.clock == null) return;
        const distance = Math.abs(clock - anchor.clock);
        const sourceDistance = Math.abs(anchor.sourceIndex - sourceIndex);
        if (
          distance < nearestDistance ||
          (distance === nearestDistance && sourceDistance < nearestSourceDistance)
        ) {
          nearestDistance = distance;
          nearestSourceDistance = sourceDistance;
          groupIndex = anchorIndex;
        }
      });
    } else if (!hasCompleteOccurrenceMapping) {
      groupIndex = scoreAnchors.reduce(
        (nearest, anchor, anchorIndex) =>
          Math.abs(anchor.sourceIndex - sourceIndex) <
          Math.abs(scoreAnchors[nearest].sourceIndex - sourceIndex)
            ? anchorIndex
            : nearest,
        0
      );
    }
    groups[groupIndex].push(campo);
  });

  return groups.filter(group => group.length > 0);
};
