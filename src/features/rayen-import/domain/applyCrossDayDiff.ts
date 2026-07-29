/**
 * Cross-day writer for discharge-day corrections (Capability A of "conciliar contra el egreso
 * oficial"). When the official "Alta Administrativa" report puts a discharge on an EARLIER island day
 * than the census day being synced, its movement record belongs to that previous day's record — this
 * appends it there.
 *
 * Pure + idempotent: the movement id is deterministic, so re-running a
 * sync unions instead of duplicating (movements merge by id — see `mergeMovementArrayById`). It only
 * APPENDS a movement; it never touches beds on the historical day, where the patient already occupied
 * a bed. Reuses the same movement builders as `applyCensusImportDiff`, overriding the id and the time
 * (the corrected island time from the report) so the record shapes never drift.
 */

import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { DischargeEntry } from '../contracts/censusImportDiff';
import {
  buildDischarge,
  buildTransfer,
  buildCma,
  type ApplyContext,
  type ResolvedApplyContext,
} from './applyCensusImportDiff';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
const normalizeEpisode = (episode?: string): string => String(episode ?? '').trim();

/**
 * Stable id so a re-sync merges instead of duplicating (see mergeMovementArrayById). PatientData.rut
 * defaults to '', so a blank RUT falls back to the bed — otherwise two blank-RUT discharges on the
 * same day would collapse to one id and silently drop a movement.
 */
const crossDayMovementId = (entry: DischargeEntry, day: string): string => {
  const rut = normalizeRut(entry.rut);
  const episode = String(entry.encounterId ?? '').trim();
  // Keep the established RUT ids stable, but namespace episode ids so a RUN-less encounter whose
  // numeric id equals another patient's RUT cannot silently collapse into the same movement.
  const identity = rut || (episode ? `episode-${episode}` : `bed-${entry.bedId}`);
  return `rayen-egreso:${identity}:${day}`;
};

const legacyCrossDayMovementId = (entry: DischargeEntry, day: string): string =>
  `rayen-egreso:bed-${entry.bedId}:${day}`;

const hasLegacyEpisodeMovement = (
  existing: ReadonlyArray<DischargeData | TransferData | CMAData>,
  entry: DischargeEntry,
  day: string
): boolean => {
  if (normalizeRut(entry.rut) || !entry.encounterId) return false;
  const legacyIds = new Set([
    legacyCrossDayMovementId(entry, day),
    `rayen-egreso:${String(entry.encounterId).trim()}:${day}`,
  ]);
  return existing.some(
    movement =>
      legacyIds.has(movement.id) &&
      String(movement.clinicalEpisodeId ?? '').trim() === String(entry.encounterId).trim()
  );
};

const associatedClinicalCribEntry = (entry: DischargeEntry): DischargeEntry | null => {
  const crib = entry.associatedClinicalCrib;
  if (!crib) return null;
  return {
    ...entry,
    rut: crib.rut,
    patientName: crib.patientName,
    encounterId: crib.clinicalEpisodeId,
    associatedClinicalCrib: undefined,
  };
};

/** A patient filed on a previous day: the discharge entry + the patient snapshot (from today's bed). */
export interface CrossDayEntry {
  entry: DischargeEntry;
  patient: PatientData;
}

export interface CrossDayResult {
  record: DailyRecord;
  applied: number;
}

/**
 * Append each entry's movement record to `targetRecord` (an earlier day's record) with the corrected
 * island time and a deterministic id. Returns the next record + how many were newly appended (entries
 * already present for that day are skipped, so it is safe to re-run).
 */
export const applyCrossDayDiff = (
  targetRecord: DailyRecord,
  entries: CrossDayEntry[],
  context: ApplyContext
): CrossDayResult => {
  const ctx: ResolvedApplyContext = {
    idFactory: context.idFactory,
    now: context.now ?? new Date(),
    actor: context.actor,
    syncRunId: context.syncRunId,
  };
  const day = targetRecord.date;
  const discharges: DischargeData[] = [...targetRecord.discharges];
  const transfers: TransferData[] = [...targetRecord.transfers];
  const cma: CMAData[] = [...targetRecord.cma];
  const existing = [...discharges, ...transfers, ...cma];
  const seen = new Set(existing.map(movement => movement.id));
  // Also index by patient RUT: a discharge the nurse (or a prior path) already recorded that day has
  // a DIFFERENT id than our deterministic one, so id-only dedup would append a SECOND egreso for the
  // same patient. Skip by RUT too, so a patient already egresado that day is never double-counted.
  const seenRuts = new Set(existing.map(movement => normalizeRut(movement.rut)).filter(Boolean));
  const seenEpisodes = new Set(
    existing.map(movement => normalizeEpisode(movement.clinicalEpisodeId)).filter(Boolean)
  );
  let applied = 0;

  for (const { entry, patient } of entries) {
    const id = crossDayMovementId(entry, day);
    const rut = normalizeRut(entry.rut);
    const episode = normalizeEpisode(entry.encounterId);
    const principalAlreadyRecorded =
      seen.has(id) ||
      hasLegacyEpisodeMovement(existing, entry, day) ||
      (rut && seenRuts.has(rut)) ||
      (episode && seenEpisodes.has(episode));
    const nestedEntry = entry.kind === 'alta' ? associatedClinicalCribEntry(entry) : null;
    const crib = patient.clinicalCrib;
    const hasAssociatedCrib =
      nestedEntry && crib && crib.clinicalEpisodeId === nestedEntry.encounterId;
    let changed = false;

    if (!principalAlreadyRecorded) {
      seen.add(id);
      if (rut) seenRuts.add(rut);
      if (episode) seenEpisodes.add(episode);
      const movementContext: ResolvedApplyContext = { ...ctx, idFactory: () => id };
      const principalSnapshot = hasAssociatedCrib
        ? { ...patient, clinicalCrib: undefined }
        : patient;
      if (entry.kind === 'cma') cma.push(buildCma(patient, entry, movementContext));
      else if (entry.kind === 'traslado')
        transfers.push(buildTransfer(patient, entry, targetRecord, movementContext));
      else discharges.push(buildDischarge(principalSnapshot, entry, targetRecord, movementContext));
      changed = true;
    }

    // Principal and associated RN are independent historical rows. An older/manual maternal alta
    // must not prevent the missing newborn traceability row from being backfilled.
    if (hasAssociatedCrib) {
      const nestedId = crossDayMovementId(nestedEntry, day);
      const nestedRut = normalizeRut(nestedEntry.rut);
      const nestedEpisode = normalizeEpisode(nestedEntry.encounterId);
      if (
        !seen.has(nestedId) &&
        !hasLegacyEpisodeMovement(existing, nestedEntry, day) &&
        !(nestedRut && seenRuts.has(nestedRut)) &&
        !(nestedEpisode && seenEpisodes.has(nestedEpisode))
      ) {
        seen.add(nestedId);
        if (nestedRut) seenRuts.add(nestedRut);
        if (nestedEpisode) seenEpisodes.add(nestedEpisode);
        discharges.push(
          buildDischarge(
            crib,
            nestedEntry,
            targetRecord,
            { ...ctx, idFactory: () => nestedId },
            true
          )
        );
        changed = true;
      }
    }
    if (changed) applied += 1;
  }

  return { record: { ...targetRecord, discharges, transfers, cma }, applied };
};
