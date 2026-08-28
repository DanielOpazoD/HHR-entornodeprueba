import type { DailyRecord } from '../contracts/rayenDomainContracts';

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
};

const structuralState = (record: DailyRecord) => ({
  beds: record.beds,
  activeExtraBeds: record.activeExtraBeds ?? [],
  discharges: record.discharges ?? [],
  transfers: record.transfers ?? [],
  cma: record.cma ?? [],
  rayenBedCollisionResolutions: record.rayenBedCollisionResolutions ?? [],
});

/** Metadata-only checkpointing is safe only when reconciliation leaves all structural state intact. */
export const hasUnchangedRayenStructuralState = (
  before: DailyRecord,
  after: DailyRecord
): boolean => stableStringify(structuralState(before)) === stableStringify(structuralState(after));
