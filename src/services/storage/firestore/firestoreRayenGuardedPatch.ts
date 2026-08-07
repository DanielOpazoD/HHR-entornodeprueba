const RAYEN_GUARDED_CLINICAL_FIELDS = new Set([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);

const isGuardedRayenClinicalPath = (parts: string[]): boolean => {
  if (parts[0] !== 'beds' || !parts[1]) return false;
  if (parts.length === 3) return RAYEN_GUARDED_CLINICAL_FIELDS.has(parts[2]);
  return (
    parts.length === 4 &&
    parts[2] === 'clinicalCrib' &&
    RAYEN_GUARDED_CLINICAL_FIELDS.has(parts[3])
  );
};

const isHistoricalRayenCudyrPath = (parts: string[]): boolean =>
  (parts.length === 4 &&
    parts[0] === 'beds' &&
    Boolean(parts[1]) &&
    parts[2] === 'evaluationScores' &&
    parts[3] === 'cudyr') ||
  (parts.length === 5 &&
    parts[0] === 'beds' &&
    Boolean(parts[1]) &&
    parts[2] === 'clinicalCrib' &&
    parts[3] === 'evaluationScores' &&
    parts[4] === 'cudyr');

const isSupportedContainerPath = (
  parts: string[],
  recordScope: 'run' | 'historical'
): boolean => {
  if (parts[0] !== 'beds' || parts.length > 1 && !parts[1]) return false;
  if (parts.length <= 2) return true;
  if (recordScope === 'run') {
    return parts.length === 3 && parts[2] === 'clinicalCrib';
  }
  return (
    (parts.length === 3 && ['evaluationScores', 'clinicalCrib'].includes(parts[2])) ||
    (parts.length === 4 &&
      parts[2] === 'clinicalCrib' &&
      parts[3] === 'evaluationScores')
  );
};

const asPatchRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Narrows prepared Rayen writes to atomic server-owned fields. It accepts dotted, nested and
 * partially dotted input without flattening the clinical objects themselves.
 */
export const extractGuardedRayenClinicalPatch = (
  patch: Record<string, unknown>,
  recordScope: 'run' | 'historical'
): Record<string, unknown> => {
  const guardedPatch: Record<string, unknown> = {};
  const isAllowedPath = recordScope === 'historical'
    ? isHistoricalRayenCudyrPath
    : isGuardedRayenClinicalPath;

  const visit = (parts: string[], value: unknown): void => {
    if (isAllowedPath(parts)) {
      guardedPatch[parts.join('.')] = value;
      return;
    }
    if (!isSupportedContainerPath(parts, recordScope)) return;

    const nestedValue = asPatchRecord(value);
    if (!nestedValue) return;
    for (const [nestedPath, nestedFieldValue] of Object.entries(nestedValue)) {
      visit([...parts, ...nestedPath.split('.')], nestedFieldValue);
    }
  };

  for (const [path, value] of Object.entries(patch)) {
    visit(path.split('.'), value);
  }

  return guardedPatch;
};
