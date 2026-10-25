export interface LegacyNullNormalizationReport {
  replacedNullCount: number;
  droppedArrayEntriesCount: number;
  affectedPaths: string[];
}

const MAX_TRACKED_PATHS = 20;

const pushAffectedPath = (affectedPaths: string[], path: string): void => {
  if (!path || affectedPaths.includes(path) || affectedPaths.length >= MAX_TRACKED_PATHS) {
    return;
  }
  affectedPaths.push(path);
};

const normalizeNode = (
  value: unknown,
  path: string,
  report: LegacyNullNormalizationReport
): unknown => {
  if (value === null) {
    report.replacedNullCount += 1;
    pushAffectedPath(report.affectedPaths, path || '<root>');
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item, index) => normalizeNode(item, `${path}[${index}]`, report))
      .filter(item => item !== undefined);

    report.droppedArrayEntriesCount += value.length - normalizedItems.length;
    return normalizedItems;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalizedEntries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      // An identity review holds what storage held: it is never normalized.
      const normalizedChild =
        key === 'identityReview' ? child : normalizeNode(child, childPath, report);
      return [key, normalizedChild] as const;
    })
    .filter(([, child]) => child !== undefined);

  return Object.fromEntries(normalizedEntries);
};

export const normalizeLegacyNullsDeep = (
  value: unknown
): { normalized: unknown; report: LegacyNullNormalizationReport } => {
  const report: LegacyNullNormalizationReport = {
    replacedNullCount: 0,
    droppedArrayEntriesCount: 0,
    affectedPaths: [],
  };

  return {
    normalized: normalizeNode(value, '', report),
    report,
  };
};
