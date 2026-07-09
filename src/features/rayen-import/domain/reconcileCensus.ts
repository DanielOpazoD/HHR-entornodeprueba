/**
 * Reconciles a Rayen census snapshot against the current HHR `DailyRecord` and
 * produces a `CensusImportDiff` (admissions / updates / transfers / discharges /
 * conflicts). Pure and deterministic — no persistence, no side effects.
 *
 * Matching key: `clinicalEpisodeId` (Rayen encId) first, then RUN. See
 * PLAN-SINCRONIZACION.md §4 for the reconciliation rules.
 */

import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
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
];

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

/** A patient leaving Rayen: discharged flag, an explicit discharge datetime, or deceased. */
const isDischarged = (encounter: RayenEncounter): boolean =>
  !!encounter.hasMedicalDischarge || !!encounter.dischargeDatetime || !!encounter.isDead;

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

  const diff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    conflicts: [],
    unchangedCount: 0,
    summary: { admissions: 0, updates: 0, moves: 0, discharges: 0, conflicts: 0, unchanged: 0 },
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

  const active = snapshot.encounters.filter(encounter => !isDischarged(encounter));
  const discharged = snapshot.encounters.filter(isDischarged);

  // ---- Active encounters → admissions / updates / transfers ----
  for (const encounter of active) {
    const { patient, isCma, bedId } = rayenToPatientData(encounter, reference);
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

    // New admission: the target bed must be free (or being vacated by a moving patient).
    if (!claimTarget(bedId, patient.patientName, encounter)) continue;
    const occupant = current.beds[bedId];
    if (isOccupied(occupant) && !consumedBedIds.has(bedId)) {
      diff.conflicts.push({
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: `La cama ${bedId} ya está ocupada por ${occupant.patientName} en el censo local.`,
        source: encounter,
      });
      continue;
    }
    diff.admissions.push({ bedId, patient, isCma, source: encounter });
  }

  // ---- Discharged encounters → discharge entries for matched patients ----
  for (const encounter of discharged) {
    const match = findCurrent(encounter);
    if (!match || consumedBedIds.has(match.bedId)) continue;
    consumedBedIds.add(match.bedId);
    const { isCma } = rayenToPatientData(encounter, reference);
    const intent = resolveDischargeIntent(encounter, isCma);
    diff.discharges.push({
      bedId: match.bedId,
      rut: match.patient.rut,
      patientName: match.patient.patientName,
      kind: intent.kind,
      status: intent.status,
      reason: 'rayen-discharge',
      source: encounter,
    });
  }

  // ---- Current patients absent from the snapshot → discharge candidates (review) ----
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

  diff.summary = {
    admissions: diff.admissions.length,
    updates: diff.updates.length,
    moves: diff.moves.length,
    discharges: diff.discharges.length,
    conflicts: diff.conflicts.length,
    unchanged: diff.unchangedCount,
  };

  return diff;
};
