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
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import { stateFromBoolean } from './dischargeVerification';
import { reconcileClinicalCribs } from './reconcileClinicalCribs';
import { diffSyncablePatientFields } from './patientSyncPolicy';

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

  // Episodes/RUTs already represented by a statistical HHR movement. Their absence from beds
  // is intentional, so a matching Ficha encounter must not be re-admitted. A patient merely
  // deleted from HHR is absent from these records and can be restored provisionally.
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
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
  };

  // Current beds consumed by a matched Rayen encounter (so they are not later treated as
  // "missing in Rayen"). Includes the source bed of updates, transfers and discharges.
  const consumedBedIds = new Set<string>();
  const confirmedPrincipalBedIds = new Set<string>();
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
  const tryAdmit = (encounter: RayenEncounter, patient: PatientData, bedId: string): boolean => {
    if (!claimTarget(bedId, patient.patientName, encounter)) return false;
    const occupant = current.beds[bedId];
    if (isOccupied(occupant) && !consumedBedIds.has(bedId)) {
      diff.conflicts.push({
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: `La cama ${bedId} ya está ocupada por ${occupant.patientName} en el censo local.`,
        source: encounter,
      });
      return false;
    }
    diff.admissions.push({ bedId, patient, isCma: false, source: encounter });
    return true;
  };

  const active = snapshot.encounters.filter(encounter => !isDischarged(encounter));
  const discharged = snapshot.encounters.filter(isDischarged);
  const activeMapped = active.map(encounter => ({
    encounter,
    mapped: rayenToPatientData(encounter, reference),
  }));

  // ---- Active encounters → admissions / updates / transfers ----
  for (const { encounter, mapped } of activeMapped.filter(item => !item.mapped.isClinicalCrib)) {
    const { patient, bedId } = mapped;
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
        confirmedPrincipalBedIds.add(bedId);
        const changes = diffSyncablePatientFields(match.patient, patient);
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
        confirmedPrincipalBedIds.add(bedId);
      }
      continue;
    }

    // New patient not yet in the census → admit into the mapped bed if it is free, UNLESS they were
    // admitted after the census day being synced (they don't belong in a past day's census).
    if (admittedAfterCensusDay(encounter, censusDay)) continue;
    if (tryAdmit(encounter, patient, bedId)) confirmedPrincipalBedIds.add(bedId);
  }

  // ---- Clinically closed encounters (epicrisis médica / enfermería) ----
  // Ficha Médico is NOT the authority for the statistical discharge. Even when both clinical
  // closures are complete, the patient stays in the HHR bed until the Gestión de Camas
  // administrative-discharge report confirms the departure and its destination.
  for (const encounter of discharged) {
    const mapped = rayenToPatientData(encounter, reference);
    // A clinical closure never promotes an attached crib into an independent HHR bed.
    // Preserve any current nested record until the administrative workflow resolves it.
    if (mapped.isClinicalCrib) continue;
    const match = findCurrent(encounter);
    if (match) {
      if (consumedBedIds.has(match.bedId)) continue;
      consumedBedIds.add(match.bedId);
      // Old Ficha responses may omit room/bed on closure. An omitted location is compatible with
      // the matched local patient; an explicit different location is not authoritative here.
      if (!mapped.bedId || mapped.bedId === match.bedId) {
        confirmedPrincipalBedIds.add(match.bedId);
      }
      diff.pendingAdministrativeDischarges.push({
        bedId: match.bedId,
        rut: match.patient.rut,
        patientName: match.patient.patientName,
        signal: 'clinical-closure',
        encounterId: encounter.encounterId,
        verification: {
          medicalEpicrisis: stateFromBoolean(encounter.hasMedicalDischarge),
          nursingEpicrisis: stateFromBoolean(encounter.hasNurseDischarge),
          hospitalDischarge: 'unknown',
        },
        source: encounter,
      });
      continue;
    }
    // A movement already recorded in HHR remains an explicit local decision. Otherwise, restore
    // the clinically closed encounter if its bed can be resolved; the administrative report may
    // later replace that provisional admission with the definitive statistical movement.
    if (wasDischargedInHhr(encounter)) continue;
    const { patient, bedId } = mapped;
    if (bedId && tryAdmit(encounter, patient, bedId)) {
      confirmedPrincipalBedIds.add(bedId);
    }
  }

  // Reconcile cribs only after both active and clinically closed principal patients have been
  // resolved. This lets a provisional principal admission receive its newborn in the same diff.
  reconcileClinicalCribs(
    current,
    activeMapped.filter(
      item => item.mapped.isClinicalCrib && !admittedAfterCensusDay(item.encounter, censusDay)
    ),
    diff,
    confirmedPrincipalBedIds
  );

  // ---- Current patients absent from the snapshot → administrative confirmation pending ----
  // Absence from Ficha Médico is only a signal. It never creates a movement or vacates a bed;
  // the authoritative Gestión de Camas report must confirm the statistical discharge.
  if (snapshot.isComplete === true) {
    for (const bedId of occupiedBedIds) {
      if (consumedBedIds.has(bedId)) continue;
      const patient = current.beds[bedId];
      if (!isOccupied(patient)) continue;
      diff.pendingAdministrativeDischarges.push({
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        signal: 'missing-from-ficha',
        encounterId: patient.clinicalEpisodeId,
        verification: {
          medicalEpicrisis: 'unknown',
          nursingEpicrisis: 'unknown',
          hospitalDischarge: 'unknown',
        },
      });
    }
  }

  diff.summary = {
    admissions: diff.admissions.length,
    updates: diff.updates.length,
    moves: diff.moves.length,
    discharges: diff.discharges.length,
    pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges.length,
    conflicts: diff.conflicts.length,
    unchanged: diff.unchangedCount,
  };

  return diff;
};

/**
 * True when a diff contains items a human must review: conflicts, clinical closures still
 * awaiting the administrative discharge, or report rows that HHR has not recorded yet.
 */
export const requiresReview = (diff: CensusImportDiff): boolean =>
  diff.conflicts.length > 0 ||
  diff.pendingAdministrativeDischarges.length > 0 ||
  (diff.reportEgresos?.length ?? 0) > 0;
