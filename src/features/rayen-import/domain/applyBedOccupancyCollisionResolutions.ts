import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';
import { normalizeRut } from '@/utils/rutUtils';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';
import type {
  BedOccupancyCollisionCandidate,
  CensusImportDiff,
  DischargeEntry,
} from '../contracts/censusImportDiff';
import { reservedRayenStructuralTargetBedIds } from './bedOccupancyCollisionPolicy';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import { diffSyncablePatientFields } from './patientSyncPolicy';
import { matchesDischargeSubject } from './dischargeSubjectIdentity';

interface EpisodeInBed {
  bedId: string;
  patient: PatientData;
}

interface CollisionApplyOptions {
  current: DailyRecord;
  diff: CensusImportDiff;
  nextBeds: Record<string, PatientData>;
  discharges: DischargeData[];
  transfers: TransferData[];
  buildDischarge: (patient: PatientData, entry: DischargeEntry) => DischargeData;
  buildTransfer: (patient: PatientData, entry: DischargeEntry) => TransferData;
}

export interface CollisionApplyResult {
  applied: { admissions: number; updates: number; moves: number; discharges: number };
  skipped: { kind: 'bed-collision'; bedId: string; reason: string }[];
  resolutionReceipts: RayenBedCollisionResolutionReceipt[];
  consumedDischarges: DischargeEntry[];
}

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(patient?.patientName?.trim() && !patient.isBlocked);

const isBlocked = (patient: PatientData | undefined): boolean => Boolean(patient?.isBlocked);

const findEpisodeInBeds = (
  beds: DailyRecord['beds'],
  clinicalEpisodeId: string
): EpisodeInBed | undefined => {
  for (const [bedId, patient] of Object.entries(beds)) {
    if (isOccupied(patient) && patient.clinicalEpisodeId?.trim() === clinicalEpisodeId) {
      return { bedId, patient };
    }
  }
  return undefined;
};

const matchesCandidateIdentity = (
  patient: PatientData,
  candidate: BedOccupancyCollisionCandidate
): boolean => {
  const storedEpisodeId = patient.clinicalEpisodeId?.trim();
  if (storedEpisodeId) return storedEpisodeId === candidate.clinicalEpisodeId;
  const storedRut = normalizeRut(patient.rut);
  const candidateRut = normalizeRut(candidate.patient.rut || candidate.source.run);
  const storedAdmissionDate = patient.admissionDate?.trim();
  const candidateAdmissionDate = candidate.patient.admissionDate?.trim();
  const storedAdmissionTime = patient.admissionTime?.trim();
  const candidateAdmissionTime = candidate.patient.admissionTime?.trim();
  return Boolean(
    storedRut &&
    candidateRut &&
    storedRut === candidateRut &&
    storedAdmissionDate &&
    candidateAdmissionDate &&
    storedAdmissionDate === candidateAdmissionDate &&
    storedAdmissionTime &&
    candidateAdmissionTime &&
    storedAdmissionTime === candidateAdmissionTime
  );
};

const findCandidateInBeds = (
  beds: DailyRecord['beds'],
  candidate: BedOccupancyCollisionCandidate
): EpisodeInBed | undefined => {
  const episodeMatch = findEpisodeInBeds(beds, candidate.clinicalEpisodeId);
  if (episodeMatch) return episodeMatch;
  if (!candidate.currentBedId) return undefined;
  const patient = beds[candidate.currentBedId];
  return isOccupied(patient) && matchesCandidateIdentity(patient, candidate)
    ? { bedId: candidate.currentBedId, patient }
    : undefined;
};

const mergeRayenPatient = (
  current: PatientData | undefined,
  incoming: PatientData
): PatientData => {
  if (!current) return incoming;
  const merged = { ...current } as unknown as Record<string, unknown>;
  for (const change of diffSyncablePatientFields(current, incoming))
    merged[change.field] = change.to;
  return merged as unknown as PatientData;
};

const movementEntry = (
  bedId: string,
  patient: PatientData,
  kind: DischargeEntry['kind']
): DischargeEntry => ({
  bedId,
  rut: patient.rut,
  patientName: patient.patientName,
  kind,
  status: 'Vivo',
  reason: 'manual-bed-collision-resolution',
  encounterId: patient.clinicalEpisodeId,
});

export const isDischargeOverriddenByCollisionReview = (
  diff: CensusImportDiff,
  entry: DischargeEntry,
  appliedReceipts: RayenBedCollisionResolutionReceipt[]
): boolean => {
  const episodeId =
    entry.encounterId ?? entry.source?.encounterId ?? entry.expectedOccupant?.clinicalEpisodeId;
  const matchesCandidate = (candidate: BedOccupancyCollisionCandidate): boolean => {
    if (episodeId) return candidate.clinicalEpisodeId === episodeId;
    const expected = entry.expectedOccupant;
    const entryRut = normalizeRut(expected?.rut ?? entry.rut);
    const candidateRut = normalizeRut(candidate.patient.rut || candidate.source.run);
    return Boolean(
      entryRut &&
      candidateRut &&
      entryRut === candidateRut &&
      expected?.admissionDate &&
      expected.admissionTime &&
      candidate.patient.admissionDate === expected.admissionDate &&
      candidate.patient.admissionTime === expected.admissionTime
    );
  };
  return Boolean(
    appliedReceipts.some(receipt =>
      diff.bedOccupancyCollisions
        ?.find(collision => collision.id === receipt.id)
        ?.candidates.some(matchesCandidate)
    )
  );
};

/** Applies each reviewed CMA/physical-equivalent bed decision before ordinary census operations. */
export const applyBedOccupancyCollisionResolutions = ({
  current: _current,
  diff,
  nextBeds,
  discharges,
  transfers,
  buildDischarge,
  buildTransfer,
}: CollisionApplyOptions): CollisionApplyResult => {
  const applied = { admissions: 0, updates: 0, moves: 0, discharges: 0 };
  const skipped: CollisionApplyResult['skipped'] = [];
  const resolutionReceipts: RayenBedCollisionResolutionReceipt[] = [];
  const consumedDischarges: DischargeEntry[] = [];
  const reviewed = diff.bedOccupancyCollisionResolutions ?? [];
  const plannedTargets = new Set(reservedRayenStructuralTargetBedIds(diff));
  const moveTargets = reviewed.flatMap(resolution =>
    resolution.otherDisposition.kind === 'move' ? [resolution.otherDisposition.targetBedId] : []
  );
  const duplicateMoveTargets = new Set(
    moveTargets.filter((targetBedId, index) => moveTargets.indexOf(targetBedId) !== index)
  );
  const plannedDischarge = (bedId: string, patient: PatientData | undefined) =>
    isOccupied(patient)
      ? diff.discharges.find(
          entry => entry.bedId === bedId && matchesDischargeSubject(patient, entry)
        )
      : undefined;

  const invalidResolution = reviewed.find(resolution => {
    const collision = (diff.bedOccupancyCollisions ?? []).find(
      item => item.id === resolution.collisionId
    );
    const selected = collision?.candidates.find(
      candidate => candidate.clinicalEpisodeId === resolution.selectedEpisodeId
    );
    const other = collision?.candidates.find(
      candidate => candidate.clinicalEpisodeId !== resolution.selectedEpisodeId
    );
    if (!collision || !selected || !other) return true;
    const unavailable = (bedId: string, patient: PatientData | undefined): boolean =>
      isBlocked(patient) ||
      (isOccupied(patient) &&
        !matchesCandidateIdentity(patient, selected) &&
        !matchesCandidateIdentity(patient, other) &&
        !plannedDischarge(bedId, patient));
    if (unavailable(collision.bedId, nextBeds[collision.bedId])) return true;
    if (resolution.otherDisposition.kind !== 'move') return false;
    const targetBedId = resolution.otherDisposition.targetBedId;
    return (
      duplicateMoveTargets.has(targetBedId) ||
      plannedTargets.has(targetBedId) ||
      unavailable(targetBedId, nextBeds[targetBedId])
    );
  });

  // The reviewed decisions form one structural choice. Validate the complete set before touching
  // any bed so two collisions can never partially apply or silently compete for one destination.
  if (invalidResolution) {
    return {
      applied,
      resolutionReceipts,
      consumedDischarges,
      skipped: reviewed.map(resolution => {
        const collision = (diff.bedOccupancyCollisions ?? []).find(
          item => item.id === resolution.collisionId
        );
        return {
          kind: 'bed-collision' as const,
          bedId: collision?.bedId ?? '—',
          reason: 'La distribución revisada ya no está disponible; vuelve a revisarla.',
        };
      }),
    };
  }

  for (const resolution of reviewed) {
    const collision = (diff.bedOccupancyCollisions ?? []).find(
      item => item.id === resolution.collisionId
    );
    const selected = collision?.candidates.find(
      candidate => candidate.clinicalEpisodeId === resolution.selectedEpisodeId
    );
    const other = collision?.candidates.find(
      candidate => candidate.clinicalEpisodeId !== resolution.selectedEpisodeId
    );
    if (!collision || !selected || !other) {
      skipped.push({
        kind: 'bed-collision',
        bedId: collision?.bedId ?? '—',
        reason: 'La decisión ya no corresponde a la colisión revisada.',
      });
      continue;
    }

    const selectedCurrent = findCandidateInBeds(nextBeds, selected);
    const otherCurrent = findCandidateInBeds(nextBeds, other);
    const targetBedId =
      resolution.otherDisposition.kind === 'move'
        ? resolution.otherDisposition.targetBedId
        : undefined;
    const vacatePlannedDischarge = (bedId: string | undefined): void => {
      if (!bedId) return;
      const patient = nextBeds[bedId];
      if (
        !isOccupied(patient) ||
        matchesCandidateIdentity(patient, selected) ||
        matchesCandidateIdentity(patient, other)
      )
        return;
      const entry = plannedDischarge(bedId, patient);
      if (!entry) return;
      delete nextBeds[bedId];
      discharges.push(buildDischarge(patient, entry));
      consumedDischarges.push(entry);
      applied.discharges += 1;
    };
    vacatePlannedDischarge(collision.bedId);
    vacatePlannedDischarge(targetBedId);
    const unrelatedOccupant = (patient: PatientData | undefined): boolean =>
      isBlocked(patient) ||
      (isOccupied(patient) &&
        !matchesCandidateIdentity(patient, selected) &&
        !matchesCandidateIdentity(patient, other));
    if (
      unrelatedOccupant(nextBeds[collision.bedId]) ||
      unrelatedOccupant(targetBedId ? nextBeds[targetBedId] : undefined)
    ) {
      skipped.push({
        kind: 'bed-collision',
        bedId: unrelatedOccupant(nextBeds[collision.bedId])
          ? collision.bedId
          : (targetBedId ?? collision.bedId),
        reason: 'La cama elegida ahora está ocupada por otro episodio.',
      });
      continue;
    }

    if (selectedCurrent) delete nextBeds[selectedCurrent.bedId];
    if (otherCurrent) delete nextBeds[otherCurrent.bedId];
    const selectedPatient = {
      ...mergeRayenPatient(selectedCurrent?.patient, selected.patient),
      clinicalEpisodeId: selected.clinicalEpisodeId,
    };
    const otherPatient = {
      ...mergeRayenPatient(otherCurrent?.patient, other.patient),
      clinicalEpisodeId: other.clinicalEpisodeId,
    };
    nextBeds[collision.bedId] = normalizePatientUpcForBed(
      { ...selectedPatient, bedId: selectedCurrent?.bedId ?? selectedPatient.bedId },
      collision.bedId
    );
    if (!selectedCurrent) applied.admissions += 1;
    else if (selectedCurrent.bedId !== collision.bedId) applied.moves += 1;
    else if (diffSyncablePatientFields(selectedCurrent.patient, selected.patient).length > 0)
      applied.updates += 1;

    if (resolution.otherDisposition.kind === 'move') {
      nextBeds[resolution.otherDisposition.targetBedId] = normalizePatientUpcForBed(
        { ...otherPatient, bedId: otherCurrent?.bedId ?? otherPatient.bedId },
        resolution.otherDisposition.targetBedId
      );
      if (!otherCurrent) applied.admissions += 1;
      else if (otherCurrent.bedId !== resolution.otherDisposition.targetBedId) applied.moves += 1;
      else if (diffSyncablePatientFields(otherCurrent.patient, other.patient).length > 0)
        applied.updates += 1;
    } else if (resolution.otherDisposition.kind === 'discharge') {
      discharges.push(
        buildDischarge(
          otherPatient,
          movementEntry(otherCurrent?.bedId ?? collision.bedId, otherPatient, 'alta')
        )
      );
      applied.discharges += 1;
    } else if (resolution.otherDisposition.kind === 'transfer') {
      transfers.push(
        buildTransfer(
          otherPatient,
          movementEntry(otherCurrent?.bedId ?? collision.bedId, otherPatient, 'traslado')
        )
      );
      applied.discharges += 1;
    }
    resolutionReceipts.push({
      id: resolution.collisionId,
      selectedEpisodeId: selected.clinicalEpisodeId,
      otherEpisodeId: other.clinicalEpisodeId,
      otherDisposition: resolution.otherDisposition,
    });
  }
  return { applied, skipped, resolutionReceipts, consumedDischarges };
};
