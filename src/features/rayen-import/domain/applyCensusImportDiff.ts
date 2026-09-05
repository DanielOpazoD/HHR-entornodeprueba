/**
 * Applies a (reviewed) `CensusImportDiff` onto a `DailyRecord`, returning the next
 * record plus what was applied/skipped. Pure and deterministic given `idFactory`
 * and `now` — no persistence here (that is the use-case's job).
 *
 * It never overwrites an occupied bed; skipped operations are reported.
 */

import { buildMovementUndoSnapshot } from '@/utils/movementUndoSnapshot';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';
import { CensusManager } from '@/domain/CensusManager';
import { BEDS, OCCUPANCY_ONLY_EXTRA_BED_IDS } from '@/constants/beds';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { CensusImportDiff, DischargeEntry } from '../contracts/censusImportDiff';
import type { ReportEgreso } from '../contracts/egresoReport';
import { parseStatisticalEgresoStamp } from '../mapping/reportEgresoDateTime';
import { normalizeRut } from '@/utils/rutUtils';
import * as collisionApply from './applyBedOccupancyCollisionResolutions';
import { buildRayenMovementProvenance } from './rayenMovementProvenance';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';
import { matchesDischargeSubject } from './dischargeSubjectIdentity';
import { filterRecordedOutcomeActions } from './filterRecordedOutcomeActions';
const BED_NAME = new Map(BEDS.map(bed => [bed.id, bed.name]));
const BED_TYPE = new Map<string, string>(BEDS.map(bed => [bed.id, bed.type]));
export const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

const hhmm = (now: Date): string => now.toTimeString().slice(0, 5);

const asSpecialty = (value: PatientData['specialty']): string =>
  typeof value === 'string' ? value : String(value);

/** The record's own day as ISO (accepts ISO or DD/MM/YYYY), for comparing against a corrected day. */
const isoDayOf = (date: string): string => {
  const iso = (date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = (date ?? '').match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return date ?? '';
};

export interface ApplyContext {
  /** Generates unique ids for the movement records. */
  idFactory: () => string;
  /** Reference "now" for timestamps (defaults to new Date()). */
  now?: Date;
  /** Attributable user and run for provenance of Gestión de Camas movements. */
  actor?: string;
  syncRunId: string;
}

export interface ResolvedApplyContext {
  idFactory: () => string;
  now: Date;
  actor?: string;
  syncRunId: string;
}

export interface SkippedOp {
  kind: 'admission' | 'move' | 'update' | 'discharge' | 'bed-collision';
  bedId: string;
  reason: string;
}

export interface ApplyResult {
  record: DailyRecord;
  applied: { admissions: number; updates: number; moves: number; discharges: number };
  skipped: SkippedOp[];
}

export const mergeRayenBedCollisionResolutionReceipts = (
  current: readonly RayenBedCollisionResolutionReceipt[],
  latest: readonly RayenBedCollisionResolutionReceipt[]
): RayenBedCollisionResolutionReceipt[] => {
  const receipts = new Map(current.map(receipt => [receipt.id, receipt] as const));
  for (const receipt of latest) {
    receipts.delete(receipt.id);
    receipts.set(receipt.id, receipt);
  }
  return Array.from(receipts.values()).slice(-50);
};

export const buildDischarge = (
  patient: PatientData,
  entry: DischargeEntry,
  record: DailyRecord,
  ctx: ResolvedApplyContext,
  isNested = false,
  provenanceSource: 'manual' | 'gestion_camas' = 'gestion_camas'
): DischargeData => {
  const id = ctx.idFactory();
  return {
    id,
    movementDate: record.date,
    admissionDate: patient.admissionDate || undefined,
    bedName: isNested
      ? `${BED_NAME.get(entry.bedId) ?? entry.bedId} (Cuna RN)`
      : (BED_NAME.get(entry.bedId) ?? entry.bedId),
    bedId: entry.bedId,
    bedType: isNested ? 'Cuna' : (BED_TYPE.get(entry.bedId) ?? ''),
    patientName: patient.patientName,
    rut: patient.rut,
    diagnosis: patient.pathology,
    specialty: asSpecialty(patient.specialty),
    time: entry.correctedTime || hhmm(ctx.now),
    status: entry.status,
    dischargeType: !isNested && entry.status === 'Vivo' ? 'Domicilio (Habitual)' : undefined,
    age: patient.age || undefined,
    insurance: patient.insurance,
    origin: patient.origin,
    isRapanui: patient.isRapanui,
    originalData: buildMovementUndoSnapshot(patient),
    clinicalEpisodeId: patient.clinicalEpisodeId,
    isNested,
    movementProvenance: buildRayenMovementProvenance(id, ctx, provenanceSource),
  };
};

const matchesAssociatedCrib = (patient: PatientData, entry: DischargeEntry): boolean => {
  const expectedEpisode = entry.associatedClinicalCrib?.clinicalEpisodeId;
  return Boolean(expectedEpisode && patient.clinicalCrib?.clinicalEpisodeId === expectedEpisode);
};

export const buildTransfer = (
  patient: PatientData,
  entry: DischargeEntry,
  record: DailyRecord,
  ctx: ResolvedApplyContext,
  provenanceSource: 'manual' | 'gestion_camas' = 'gestion_camas'
): TransferData => {
  const id = ctx.idFactory();
  return {
    id,
    movementDate: record.date,
    admissionDate: patient.admissionDate || undefined,
    bedName: BED_NAME.get(entry.bedId) ?? entry.bedId,
    bedId: entry.bedId,
    bedType: BED_TYPE.get(entry.bedId) ?? '',
    patientName: patient.patientName,
    rut: patient.rut,
    diagnosis: patient.pathology,
    specialty: asSpecialty(patient.specialty),
    time: entry.correctedTime || hhmm(ctx.now),
    evacuationMethod: '',
    receivingCenter: '',
    age: patient.age || undefined,
    insurance: patient.insurance,
    origin: patient.origin,
    isRapanui: patient.isRapanui,
    originalData: buildMovementUndoSnapshot(patient),
    clinicalEpisodeId: patient.clinicalEpisodeId,
    movementProvenance: buildRayenMovementProvenance(id, ctx, provenanceSource),
  };
};

export const buildCma = (
  patient: PatientData,
  entry: DischargeEntry,
  ctx: ResolvedApplyContext
): CMAData => {
  const id = ctx.idFactory();
  return {
    ...CensusManager.formatCMAData(patient, entry.bedId),
    id,
    timestamp: ctx.now.toISOString(),
    dischargeTime: entry.correctedTime || hhmm(ctx.now),
    clinicalEpisodeId: patient.clinicalEpisodeId,
    movementProvenance: buildRayenMovementProvenance(id, ctx, 'gestion_camas'),
  };
};

/**
 * The official statistical egreso time, normalized from Gestión de Camas to the Rapa Nui clock.
 * Pre-normalized API results carry correctedTime and therefore do not pass through this fallback.
 */
const reportEgresoTime = (fechaEgreso: string): string =>
  parseStatisticalEgresoStamp(fechaEgreso)?.hhmm ?? '';

// A report egreso HHR never synced has no bed here — synthesize the minimal patient the movement
// builders read, so the day's altas census can log it from the report's data.
export const reportEgresoPatient = (egreso: ReportEgreso): PatientData =>
  ({
    patientName: egreso.patientName,
    rut: egreso.run,
    pathology: egreso.diagnostico ?? '',
    specialty: egreso.servicio ?? '',
    age: egreso.edad ?? undefined,
    clinicalEpisodeId: egreso.encounterId,
    admissionDate: egreso.admissionDay ?? '',
    admissionTime: egreso.admissionTime ?? '',
  }) as unknown as PatientData;

/**
 * Adapts a report-only egreso for the movement builders. It is intentionally used only when the
 * patient never occupied a bed in this HHR census (or when filing its historical movement); it does
 * not enter the bed-vacating discharge loop, whose entries carry a previewed occupant fingerprint.
 */
export const reportEgresoEntry = (egreso: ReportEgreso): DischargeEntry => ({
  bedId: egreso.bedLabel,
  rut: egreso.run,
  patientName: egreso.patientName,
  encounterId: egreso.encounterId,
  kind: egreso.kind,
  status: egreso.status,
  reason: 'administrative-discharge',
  correctedDay: egreso.correctedDay,
  correctedTime: egreso.correctedTime,
});

const dischargeIdentityMismatchReason = (patient: PatientData, entry: DischargeEntry): string => {
  const expected = entry.expectedOccupant;
  if (!expected || expected.clinicalEpisodeId) {
    return 'La cama ahora corresponde a otro paciente.';
  }
  const sameRun = Boolean(
    normalizeRut(patient.rut) && normalizeRut(patient.rut) === normalizeRut(expected.rut)
  );
  if (sameRun && (!expected.admissionDate || !expected.admissionTime)) {
    return 'No se pudo confirmar la identidad del ocupante (falta el sello de ingreso).';
  }
  return 'La cama ahora corresponde a otro paciente.';
};

export const applyCensusImportDiff = (
  current: DailyRecord,
  diff: CensusImportDiff,
  context: ApplyContext
): ApplyResult => {
  const ctx: ResolvedApplyContext = {
    idFactory: context.idFactory,
    now: context.now ?? new Date(),
    actor: context.actor,
    syncRunId: context.syncRunId,
  };
  const nextBeds: Record<string, PatientData> = { ...current.beds };
  const discharges: DischargeData[] = [...current.discharges];
  const transfers: TransferData[] = [...current.transfers];
  const cma: CMAData[] = [...current.cma];
  const skipped: SkippedOp[] = [];
  const applied = { admissions: 0, updates: 0, moves: 0, discharges: 0 };
  const effectiveDiff = filterRecordedOutcomeActions(current, diff);
  const collisionResult = collisionApply.applyBedOccupancyCollisionResolutions({
    current,
    diff: effectiveDiff,
    nextBeds,
    discharges,
    transfers,
    buildDischarge: (patient, entry) =>
      buildDischarge(patient, entry, current, ctx, false, 'manual'),
    buildTransfer: (patient, entry) => buildTransfer(patient, entry, current, ctx, 'manual'),
  });
  skipped.push(...collisionResult.skipped);
  for (const key of Object.keys(applied) as (keyof typeof applied)[]) {
    applied[key] += collisionResult.applied[key];
  }
  const collisionReceipts = collisionResult.resolutionReceipts;
  // Discharges: vacate the bed and append the matching movement record.
  for (const entry of effectiveDiff.discharges) {
    // An applied collision choice overrides older discharge evidence.
    if (
      collisionResult.consumedDischarges.includes(entry) ||
      collisionApply.isDischargeOverriddenByCollisionReview(effectiveDiff, entry, collisionReceipts)
    )
      continue;
    const patient = isOccupied(current.beds[entry.bedId]) ? current.beds[entry.bedId] : undefined;
    const subject = patient ?? undefined;
    if (!subject) continue; // nothing to discharge (already gone)
    if (!matchesDischargeSubject(subject, entry)) {
      skipped.push({
        kind: 'discharge',
        bedId: entry.bedId,
        reason: dischargeIdentityMismatchReason(subject, entry),
      });
      continue;
    }
    if (
      effectiveDiff.retainedBedCollisionResolutions?.some(
        receipt => receipt.selectedEpisodeId === subject.clinicalEpisodeId
      )
    ) {
      continue;
    }
    delete nextBeds[entry.bedId];
    // A discharge whose official island day is EARLIER than this census day: the bed is vacated here
    // (the patient really left before today), but its movement record belongs to that previous day —
    // it is filed there by the cross-day writer on confirm, not appended to today.
    if (entry.correctedDay && entry.correctedDay < isoDayOf(current.date)) {
      applied.discharges += 1;
      continue;
    }
    if (entry.kind === 'cma') cma.push(buildCma(subject, entry, ctx));
    else if (entry.kind === 'traslado') transfers.push(buildTransfer(subject, entry, current, ctx));
    else {
      const associatedCrib = matchesAssociatedCrib(subject, entry)
        ? subject.clinicalCrib
        : undefined;
      // The newborn gets its own reversible movement. Keeping it in the mother's originalData too
      // would make either undo order fail because both rows would try to restore the same crib.
      const principalSnapshot = associatedCrib ? { ...subject, clinicalCrib: undefined } : subject;
      discharges.push(buildDischarge(principalSnapshot, entry, current, ctx));
      if (associatedCrib) {
        discharges.push(buildDischarge(associatedCrib, entry, current, ctx, true));
      }
    }
    applied.discharges += 1;
  }

  // 1b) Report egresos HHR never synced (unknown RUN): there is no bed to vacate — just append
  //     the movement record so the day's altas census logs them (already reviewed in the
  //     preview). The patient is synthesized from the report row; time comes from the report.
  for (const egreso of effectiveDiff.reportEgresos ?? []) {
    // With the report fetched for [D, D+1] (the source files late egresos a day ahead), the list also
    // carries egresos of a DIFFERENT island day. Only log here those whose corrected island day IS
    // this census day; earlier ones are filed on their real day by the cross-day writer, and later
    // ones belong to a future sync.
    if (egreso.correctedDay && egreso.correctedDay !== isoDayOf(current.date)) continue;
    const patient = reportEgresoPatient(egreso);
    const entry = reportEgresoEntry(egreso);
    const time = egreso.correctedTime || reportEgresoTime(egreso.fechaEgreso) || hhmm(ctx.now);
    if (egreso.kind === 'traslado') {
      transfers.push({ ...buildTransfer(patient, entry, current, ctx), time });
    } else if (egreso.kind === 'cma') {
      cma.push({ ...buildCma(patient, entry, ctx), dischargeTime: time });
    } else {
      const nested = egreso.fromClinicalCrib === true;
      discharges.push({ ...buildDischarge(patient, entry, current, ctx, nested), time });
    }
    applied.discharges += 1;
  }

  // 2) Moves: capture sources from the ORIGINAL record, free them, then place targets.
  const moveOps = effectiveDiff.moves
    .map(move => ({ move, source: current.beds[move.fromBedId] }))
    .filter(op => isOccupied(op.source));
  for (const { move } of moveOps) delete nextBeds[move.fromBedId];
  for (const { move, source } of moveOps) {
    if (isOccupied(nextBeds[move.toBedId])) {
      skipped.push({ kind: 'move', bedId: move.toBedId, reason: 'Cama destino ocupada.' });
      nextBeds[move.fromBedId] = source; // restore, do not lose the patient
      continue;
    }
    nextBeds[move.toBedId] = normalizePatientUpcForBed(source, move.toBedId);
    applied.moves += 1;
  }

  // 3) Admissions: only into a free bed.
  for (const entry of effectiveDiff.admissions) {
    if (isOccupied(nextBeds[entry.bedId])) {
      skipped.push({ kind: 'admission', bedId: entry.bedId, reason: 'Cama ocupada.' });
      continue;
    }
    nextBeds[entry.bedId] = entry.patient;
    applied.admissions += 1;
  }

  // 4) Updates: merge only the changed Rayen-sourced fields, preserving app-managed data.
  for (const entry of effectiveDiff.updates) {
    const existing = nextBeds[entry.bedId];
    if (!isOccupied(existing)) {
      skipped.push({ kind: 'update', bedId: entry.bedId, reason: 'Sin paciente en la cama.' });
      continue;
    }
    const merged = { ...existing } as unknown as Record<string, unknown>;
    for (const change of entry.changes) {
      // Re-check local authority at apply time too: the user may have selected a specialty after
      // the preview was built but before confirming it.
      if (change.field === 'specialty' && String(existing.specialty ?? '').trim()) continue;
      merged[change.field] = change.to;
    }
    nextBeds[entry.bedId] = merged as unknown as PatientData;
    applied.updates += 1;
  }

  const activeExtraBeds = [
    ...(current.activeExtraBeds ?? []).filter(bedId => !OCCUPANCY_ONLY_EXTRA_BED_IDS.has(bedId)),
    ...[...OCCUPANCY_ONLY_EXTRA_BED_IDS].filter(bedId => isOccupied(nextBeds[bedId])),
  ];

  const record: DailyRecord = {
    ...current,
    beds: nextBeds,
    activeExtraBeds: [...new Set(activeExtraBeds)],
    discharges,
    transfers,
    cma,
    rayenBedCollisionResolutions: mergeRayenBedCollisionResolutionReceipts(
      current.rayenBedCollisionResolutions ?? [],
      collisionResult.resolutionReceipts
    ),
    lastUpdated: ctx.now.toISOString(),
  };

  return { record, applied, skipped };
};
