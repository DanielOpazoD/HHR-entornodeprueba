import type { AdmissionEntry, ConflictEntry, MoveEntry } from '../contracts/censusImportDiff';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

export interface PrincipalBedPlacementIntent {
  sourceBedId?: string;
  targetBedId: string;
}

/**
 * Resolves which source beds are guaranteed to be vacated by a batch of principal-patient moves.
 * Chains and swaps are valid; a chain ending in an occupant that does not move is rejected from
 * the tail backwards. Duplicate destination claims are never considered feasible.
 */
export const feasiblePrincipalMoveSourceBedIds = (
  intents: PrincipalBedPlacementIntent[],
  occupiedBedIds: ReadonlySet<string>
): ReadonlySet<string> => {
  const targetCounts = new Map<string, number>();
  for (const intent of intents) {
    targetCounts.set(intent.targetBedId, (targetCounts.get(intent.targetBedId) ?? 0) + 1);
  }

  let candidates = intents.filter(
    (intent): intent is Required<PrincipalBedPlacementIntent> =>
      !!intent.sourceBedId &&
      intent.sourceBedId !== intent.targetBedId &&
      targetCounts.get(intent.targetBedId) === 1
  );

  let changed = true;
  while (changed) {
    changed = false;
    const sources = new Set(candidates.map(intent => intent.sourceBedId));
    const next = candidates.filter(
      intent => !occupiedBedIds.has(intent.targetBedId) || sources.has(intent.targetBedId)
    );
    if (next.length !== candidates.length) changed = true;
    candidates = next;
  }

  return new Set(candidates.map(intent => intent.sourceBedId));
};

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

export const occupiedLocalBedConflict = (
  current: DailyRecord,
  bedId: string,
  patient: Pick<PatientData, 'rut' | 'patientName'>,
  source: RayenEncounter
): ConflictEntry | null => {
  const occupant = current.beds[bedId];
  return isOccupied(occupant)
    ? {
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        code: 'occupied-local-bed',
        reason: `La cama ${bedId} ya está ocupada por ${occupant.patientName} en el censo local.`,
        source,
      }
    : null;
};

export const blockedPrincipalMoveConflict = (
  current: DailyRecord,
  sourceBedId: string,
  targetBedId: string,
  patient: PatientData,
  source: RayenEncounter
): ConflictEntry => {
  const blockedMove: MoveEntry = {
    fromBedId: sourceBedId,
    toBedId: targetBedId,
    rut: patient.rut,
    patientName: patient.patientName,
    source,
  };
  const occupiedConflict = occupiedLocalBedConflict(current, targetBedId, patient, source);
  if (occupiedConflict) return { ...occupiedConflict, blockedMove };
  return {
    bedId: targetBedId,
    rut: patient.rut,
    patientName: patient.patientName,
    code: 'principal-bed-collision',
    reason: `El movimiento a ${targetBedId} no es único en Rayen y requiere revisión.`,
    source,
    blockedMove,
  };
};

/**
 * Keeps admissions into a currently occupied bed only when an accepted move actually vacates it.
 * The earlier graph calculation proves feasibility; this final pass proves that reconciliation
 * emitted the corresponding move after target claims and other clinical guards were applied.
 */
export const finalizeAdmissionsAgainstAcceptedMoves = (
  current: DailyRecord,
  admissions: AdmissionEntry[],
  moves: MoveEntry[]
): { admissions: AdmissionEntry[]; conflicts: ConflictEntry[] } => {
  const acceptedMoveSources = new Set(moves.map(move => move.fromBedId));
  const conflicts: ConflictEntry[] = [];
  const safeAdmissions = admissions.filter(admission => {
    const conflict = admission.source
      ? occupiedLocalBedConflict(current, admission.bedId, admission.patient, admission.source)
      : null;
    if (!conflict || acceptedMoveSources.has(admission.bedId)) return true;
    conflicts.push({ ...conflict, blockedAdmission: admission });
    return false;
  });
  return { admissions: safeAdmissions, conflicts };
};

export interface VerifiedClosedBedMovePlan {
  retainedBedId: string;
  move?: MoveEntry;
  conflict?: ConflictEntry;
}

export const planVerifiedClosedBedMove = ({
  current,
  encounter,
  patient,
  sourceBedId,
  targetBedId,
  targetClaimed,
  feasibleMoveSourceBedIds,
}: {
  current: DailyRecord;
  encounter: RayenEncounter;
  patient: PatientData;
  sourceBedId: string;
  targetBedId: string | null;
  targetClaimed: boolean;
  feasibleMoveSourceBedIds: ReadonlySet<string>;
}): VerifiedClosedBedMovePlan => {
  if (!targetBedId || targetBedId === sourceBedId || !targetClaimed) {
    return { retainedBedId: sourceBedId };
  }
  if (!feasibleMoveSourceBedIds.has(sourceBedId)) {
    return {
      retainedBedId: sourceBedId,
      conflict: blockedPrincipalMoveConflict(current, sourceBedId, targetBedId, patient, encounter),
    };
  }
  return {
    retainedBedId: targetBedId,
    move: {
      fromBedId: sourceBedId,
      toBedId: targetBedId,
      rut: patient.rut,
      patientName: patient.patientName,
      source: encounter,
    },
  };
};
