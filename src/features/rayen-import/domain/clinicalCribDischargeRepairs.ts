import { BEDS } from '@/constants/beds';
import {
  getActiveDischarges,
  tombstoneMovement,
} from '@/application/census/movementTombstonePolicy';
import { normalizeRut } from '@/utils/rutUtils';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { DischargeData } from '@/types/domain/movements';
import type { ClinicalCribDischargeRepair } from '../contracts/censusImportDiff';
import { resolveReportBedId } from '../mapping/resolveReportBed';

const bedIds = new Set(BEDS.map(bed => bed.id));
const sparseSnapshotFields = new Set([
  'patientName',
  'rut',
  'pathology',
  'specialty',
  'age',
  'clinicalEpisodeId',
  'admissionDate',
  'admissionTime',
]);
const isImportedCribDeparture = (row: DischargeData, date: string): boolean =>
  row.isNested === true &&
  row.movementDate === date &&
  row.movementProvenance?.source === 'gestion_camas' &&
  Boolean(row.clinicalEpisodeId?.trim()) &&
  row.originalData?.clinicalEpisodeId === row.clinicalEpisodeId &&
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time);
const isCanonicalDeparture = (row: DischargeData): boolean =>
  bedIds.has(row.bedId) &&
  Boolean(row.admissionDate && row.originalData?.admissionDate === row.admissionDate);
const isMalformedReportCopy = (row: DischargeData): boolean =>
  /^cuna\s+/i.test(row.bedId) &&
  !row.admissionDate &&
  !row.originalData?.admissionDate &&
  !row.ieehData &&
  Object.keys(row.originalData ?? {}).every(key => sparseSnapshotFields.has(key));

// Repository reads may reorder object keys; clinical changes, not key order, invalidate review.
const reviewedSnapshot = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );

/** Only the known two-path import defect; ambiguous identities or enriched rows are not repaired. */
export const planClinicalCribDischargeRepairs = (
  record: DailyRecord
): ClinicalCribDischargeRepair[] => {
  const active = getActiveDischarges(record.discharges);
  const candidates = active.filter(row => isImportedCribDeparture(row, record.date));
  const repairs: ClinicalCribDischargeRepair[] = [];
  for (const duplicate of candidates.filter(isMalformedReportCopy)) {
    const parentBedId = resolveReportBedId(duplicate.bedId.replace(/^cuna\s+/i, ''));
    const keepers = candidates.filter(
      row =>
        row.id !== duplicate.id &&
        isCanonicalDeparture(row) &&
        row.clinicalEpisodeId === duplicate.clinicalEpisodeId &&
        row.bedId === parentBedId &&
        row.time === duplicate.time &&
        row.status === duplicate.status &&
        normalizeRut(row.rut) === normalizeRut(duplicate.rut) &&
        (!duplicate.diagnosis?.trim() || duplicate.diagnosis.trim() === row.diagnosis?.trim())
    );
    if (keepers.length !== 1 || !duplicate.id || !keepers[0].id) continue;
    const kept = keepers[0];
    if (
      [kept.id, duplicate.id].some(
        id => record.discharges.filter(row => row.id === id).length !== 1
      )
    )
      continue;
    repairs.push({ kept: structuredClone(kept), duplicate: structuredClone(duplicate) });
  }
  return repairs;
};

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
