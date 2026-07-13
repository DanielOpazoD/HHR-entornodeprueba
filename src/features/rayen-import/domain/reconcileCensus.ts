/**
 * Reconciles a Rayen census snapshot against the current HHR `DailyRecord` and
 * produces a `CensusImportDiff` (admissions / updates / transfers / discharges /
 * conflicts). Pure and deterministic — no persistence, no side effects.
 *
 * Matching key: `clinicalEpisodeId` (Rayen encId) first, then RUN. See
 * PLAN-SINCRONIZACION.md §4 for the reconciliation rules.
 */

import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import type { CensusImportDiff, DischargeEntry, FieldChange } from '../contracts/censusImportDiff';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import { resolveDischargeIntent } from '../mapping/dischargeMapping';

/** PatientData fields that the sync is allowed to source from Rayen. */
const SYNCABLE_FIELDS: Array<keyof PatientData> = [
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'rut',
  'birthDate',
  'age',
  'biologicalSex',
  'admissionDate',
  'admissionTime',
  'pathology',
  'isIsolated',
];

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

/** A patient leaving Rayen: medical/nurse discharge, an explicit discharge datetime, or deceased. */
const isDischarged = (encounter: RayenEncounter): boolean =>
  !!encounter.hasMedicalDischarge ||
  !!encounter.hasNurseDischarge ||
  !!encounter.dischargeDatetime ||
  !!encounter.isDead;

/** Extract a YYYY-MM-DD day from a record date / admission datetime (ISO or DD/MM/YYYY). '' if none. */
const toIsoDay = (raw: string | undefined): string => {
  const value = (raw ?? '').trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
};

/**
 * True when the encounter was admitted STRICTLY AFTER the census day being synced. Such a patient only
 * exists from their admission day onward, so a late sync of a PAST census must not add them to it (a
 * patient who entered today should not appear in yesterday's census). Unknown/unparseable admission
 * dates never gate — we'd rather admit than risk dropping a real patient.
 */
const admittedAfterCensusDay = (encounter: RayenEncounter, censusDay: string): boolean => {
  if (!censusDay) return false;
  const admissionDay = toIsoDay(encounter.admissionDatetime);
  return admissionDay !== '' && admissionDay > censusDay;
};

interface CurrentPatientRef {
  bedId: string;
  patient: PatientData;
}

const diffFields = (current: PatientData, incoming: PatientData): FieldChange[] => {
  const changes: FieldChange[] = [];
  for (const field of SYNCABLE_FIELDS) {
    const from = current[field];
    const to = incoming[field];
    if (String(from ?? '') !== String(to ?? '')) {
      changes.push({ field, from, to });
    }
  }
  return changes;
};

export interface ReconcileOptions {
  /** Reference date for age computation (defaults to now). */
  reference?: Date;
}

export const reconcileCensus = (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  options: ReconcileOptions = {}
): CensusImportDiff => {
  const reference = options.reference ?? new Date();
  // The census day being synced — a patient admitted after it must not be added to this (past) census.
  const censusDay = toIsoDay(current.date);

  // Index current occupied beds by episode id and by RUN.
  const currentByEpisode = new Map<string, CurrentPatientRef>();
  const currentByRut = new Map<string, CurrentPatientRef>();
  const occupiedBedIds = new Set<string>();
  for (const [bedId, patient] of Object.entries(current.beds)) {
    if (!isOccupied(patient)) continue;
    occupiedBedIds.add(bedId);
    const ref: CurrentPatientRef = { bedId, patient };
    if (patient.clinicalEpisodeId) currentByEpisode.set(patient.clinicalEpisodeId, ref);
    const rut = normalizeRut(patient.rut);
    if (rut) currentByRut.set(rut, ref);
  }

  const findCurrent = (encounter: RayenEncounter): CurrentPatientRef | undefined =>
    currentByEpisode.get(encounter.encounterId) ?? currentByRut.get(normalizeRut(encounter.run));

  // Episodes/RUTs the nurse already discharged in HHR (alta de enfermería). Their absence
  // from the beds is intentional, so a matching Rayen medical discharge must NOT be
  // re-admitted. A patient merely DELETED from HHR is absent from these records → it can
  // be restored to its bed.
  const dischargedInHhr = new Set<string>();
  for (const record of [
    ...(current.discharges ?? []),
    ...(current.cma ?? []),
    ...(current.transfers ?? []),
  ]) {
    const recordRut = normalizeRut(record.rut);
    if (recordRut) dischargedInHhr.add(`rut:${recordRut}`);
    if (record.clinicalEpisodeId) dischargedInHhr.add(`ep:${record.clinicalEpisodeId}`);
  }
  const wasDischargedInHhr = (encounter: RayenEncounter): boolean =>
    dischargedInHhr.has(`ep:${encounter.encounterId}`) ||
    dischargedInHhr.has(`rut:${normalizeRut(encounter.run)}`);

  const diff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingNursingDischarges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingNursingDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
  };

  // Current beds consumed by a matched Rayen encounter (so they are not later treated as
  // "missing in Rayen"). Includes the source bed of updates, transfers and discharges.
  const consumedBedIds = new Set<string>();
  // Target beds each incoming admission/transfer claims, to detect collisions.
  const claimedTargets = new Map<string, string>(); // bedId -> patientName

  const claimTarget = (bedId: string, patientName: string, source: RayenEncounter): boolean => {
    const existing = claimedTargets.get(bedId);
    if (existing) {
      diff.conflicts.push({
        bedId,
        patientName,
        reason: `Dos pacientes de Rayen apuntan a la misma cama ${bedId} (${existing} y ${patientName}).`,
        source,
      });
      return false;
    }
    claimedTargets.set(bedId, patientName);
    return true;
  };

  // Place a Rayen patient into their mapped bed as an admission, if the target is free. A CMA
  // patient is admitted as a NORMAL inpatient (isCma: false): "CMA" is a DISCHARGE type, resolved at
  // egreso — not an admission attribute. So a patient in the virtual CMA service occupies their real
  // bed like anyone else until they leave.
  const tryAdmit = (encounter: RayenEncounter, patient: PatientData, bedId: string): void => {
    if (!claimTarget(bedId, patient.patientName, encounter)) return;
    const occupant = current.beds[bedId];
    if (isOccupied(occupant) && !consumedBedIds.has(bedId)) {
      diff.conflicts.push({
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: `La cama ${bedId} ya está ocupada por ${occupant.patientName} en el censo local.`,
        source: encounter,
      });
      return;
    }
    diff.admissions.push({ bedId, patient, isCma: false, source: encounter });
  };

  const active = snapshot.encounters.filter(encounter => !isDischarged(encounter));
  const discharged = snapshot.encounters.filter(isDischarged);

  // ---- Active encounters → admissions / updates / transfers ----
  for (const encounter of active) {
    const { patient, bedId } = rayenToPatientData(encounter, reference);
    const match = findCurrent(encounter);

    if (!bedId) {
      diff.conflicts.push({
        bedId: null,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: `No se pudo mapear la cama de Rayen (servicio "${encounter.service ?? ''}", sala "${encounter.room ?? ''}", cama "${encounter.bed ?? ''}").`,
        source: encounter,
      });
      continue;
    }

    if (match) {
      consumedBedIds.add(match.bedId);
      if (match.bedId === bedId) {
        const changes = diffFields(match.patient, patient);
        if (changes.length === 0) {
          diff.unchangedCount += 1;
        } else {
          diff.updates.push({
            bedId,
            rut: patient.rut,
            patientName: patient.patientName,
            changes,
            patient,
            source: encounter,
          });
        }
      } else if (claimTarget(bedId, patient.patientName, encounter)) {
        diff.moves.push({
          fromBedId: match.bedId,
          toBedId: bedId,
          rut: patient.rut,
          patientName: patient.patientName,
          source: encounter,
        });
      }
      continue;
    }

    // New patient not yet in the census → admit into the mapped bed if it is free, UNLESS they were
    // admitted after the census day being synced (they don't belong in a past day's census).
    if (admittedAfterCensusDay(encounter, censusDay)) continue;
    tryAdmit(encounter, patient, bedId);
  }

  // ---- Discharged encounters (alta médica / alta de enfermería) ----
  // A Rayen medical discharge (alta médica) alone does NOT vacate the HHR bed; the nurse's
  // discharge (alta de enfermería, `hasNurseDischarge`) is what finalizes the departure.
  // So: nurse discharge → record the egreso and vacate; medical discharge only → keep the
  // patient in the bed (pending). The precise alta subtype (domicilio/traslado) is refined
  // later from gestión de camas; here we resolve alta | cma | (status Fallecido).
  for (const encounter of discharged) {
    const match = findCurrent(encounter);
    if (match) {
      if (consumedBedIds.has(match.bedId)) continue;
      consumedBedIds.add(match.bedId);
      const { isCma } = rayenToPatientData(encounter, reference);
      const intent = resolveDischargeIntent(encounter, isCma);
      if (encounter.hasNurseDischarge) {
        diff.discharges.push({
          bedId: match.bedId,
          rut: match.patient.rut,
          patientName: match.patient.patientName,
          kind: intent.kind,
          status: intent.status,
          reason: 'rayen-discharge',
          source: encounter,
        });
      } else {
        diff.pendingNursingDischarges.push({
          bedId: match.bedId,
          rut: match.patient.rut,
          patientName: match.patient.patientName,
          kind: intent.kind,
          status: intent.status,
          source: encounter,
        });
      }
      continue;
    }
    // Not in any HHR bed. If the patient's discharge is already finalized — the nurse did
    // it in Rayen (alta de enfermería), the patient is deceased, or it is recorded in HHR —
    // honor it (they correctly left). Otherwise a medical discharge alone does not finalize
    // it, so a patient absent from the bed should be restored (e.g. after an accidental
    // deletion in HHR).
    if (encounter.hasNurseDischarge || encounter.isDead || wasDischargedInHhr(encounter)) continue;
    const { patient, bedId } = rayenToPatientData(encounter, reference);
    if (bedId) tryAdmit(encounter, patient, bedId);
  }

  // ---- Current patients absent from the snapshot → discharge candidates (review) ----
  // Only inferred when the snapshot is the FULL census; a partial snapshot must never
  // imply that an unseen patient was discharged (clinical safety).
  if (snapshot.isComplete === true) {
    for (const bedId of occupiedBedIds) {
      if (consumedBedIds.has(bedId)) continue;
      const patient = current.beds[bedId];
      if (!isOccupied(patient)) continue;
      const entry: DischargeEntry = {
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        kind: 'alta',
        status: 'Vivo',
        reason: 'missing-in-rayen',
      };
      diff.discharges.push(entry);
    }
  }

  diff.summary = {
    admissions: diff.admissions.length,
    updates: diff.updates.length,
    moves: diff.moves.length,
    discharges: diff.discharges.length,
    pendingNursingDischarges: diff.pendingNursingDischarges.length,
    conflicts: diff.conflicts.length,
    unchanged: diff.unchangedCount,
  };

  return diff;
};

/**
 * True when a diff contains items a human must resolve before it is safe to apply
 * without review: conflicts, or discharges *inferred* from a patient's absence
 * (`missing-in-rayen`) rather than confirmed by Rayen. The experimental auto mode
 * must fall back to preview when this returns true.
 */
export const requiresReview = (diff: CensusImportDiff): boolean =>
  diff.conflicts.length > 0 ||
  diff.discharges.some(discharge => discharge.reason === 'missing-in-rayen') ||
  (diff.reportEgresos?.length ?? 0) > 0;
