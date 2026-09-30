import { tombstoneMovement } from '@/application/census/movementTombstonePolicy';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DischargeData } from '@/types/domain/movements';
import type { ClinicalCribDischargeRepair } from '../contracts/censusImportDiff';
import { planClinicalCribDischargeRepairs } from './censusDischargeHistory';

export { planClinicalCribDischargeRepairs } from './censusDischargeHistory';

// Repository reads may reorder object keys; clinical changes, not key order, invalidate review.
const reviewedSnapshot = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );

/** Preserve an audited tombstone, all source data and the canonical undo snapshot after review. */
export const applyClinicalCribDischargeRepairs = (
  record: DailyRecord,
  repairs: readonly ClinicalCribDischargeRepair[] | undefined,
  now: Date,
  actor?: string
): { discharges: DischargeData[]; skipped: Array<{ bedId: string; reason: string }> } => {
  const repairActor = actor?.trim();
  const eligible = planClinicalCribDischargeRepairs(record);
  const byId = new Map(record.discharges.map(row => [row.id, row]));
  const confirmedDuplicateIds = new Map<string, string>();
  const skipped: Array<{ bedId: string; reason: string }> = [];
  for (const repair of repairs ?? []) {
    const matches = eligible.some(
      candidate =>
        candidate.kept.id === repair.kept.id && candidate.duplicate.id === repair.duplicate.id
    );
    if (
      !matches ||
      reviewedSnapshot(byId.get(repair.kept.id)) !== reviewedSnapshot(repair.kept) ||
      reviewedSnapshot(byId.get(repair.duplicate.id)) !== reviewedSnapshot(repair.duplicate)
    ) {
      // An already applied repair is an idempotent retry, not a failed new operation.
      if (
        byId.get(repair.duplicate.id)?.deletedReason ===
          `duplicate_clinical_crib_discharge:${repair.kept.id}` &&
        byId.get(repair.duplicate.id)?.deletedAt
      )
        continue;
      skipped.push({
        bedId: repair.kept.bedId,
        reason:
          'El egreso RN cambió después de la revisión; vuelve a sincronizar para corregir el duplicado.',
      });
      continue;
    }
    if (!repairActor) {
      skipped.push({
        bedId: repair.kept.bedId,
        reason:
          'La corrección de egresos RN requiere identificar al operador; vuelve a iniciar sesión y sincronizar.',
      });
      continue;
    }
    confirmedDuplicateIds.set(repair.duplicate.id, repair.kept.id);
  }
  return {
    discharges: record.discharges.map(row => {
      const keptId = confirmedDuplicateIds.get(row.id);
      return keptId
        ? tombstoneMovement(row, {
            deletedAt: now.toISOString(),
            deletedBy: repairActor,
            deletedReason: `duplicate_clinical_crib_discharge:${keptId}`,
          })
        : row;
    }),
    skipped,
  };
};
