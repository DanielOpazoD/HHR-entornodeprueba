import { planReviewedNeonatalSourceChanges } from './reviewedNeonatalSourcePlacement';
import { prepareNeonatalPlacementReviews } from './neonatalPlacementReviewPlan';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenCensusSnapshot, RayenEncounter } from '../contracts/rayenSnapshot';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import { stateFromBoolean } from './dischargeVerification';
import { reconcileClinicalCribs } from './reconcileClinicalCribs';
import { diffSyncablePatientFields } from './patientSyncPolicy';
import {
  blockedPrincipalMoveConflict,
  feasiblePrincipalMoveSourceBedIds,
  finalizeAdmissionsAgainstAcceptedMoves,
  occupiedLocalBedConflict,
  planVerifiedClosedBedMove,
} from './principalBedMovePlan';
import { createCensusPatientIdentityIndex } from './censusPatientIdentityIndex';
import { admittedAfterCensusDay, toIsoCensusDay } from './censusDayPolicy';
import {
  pendingClinicalCribDischargeIdentities,
  prepareActiveClinicalPlacements,
  shouldReconcileAsPrincipal,
} from './clinicalCribPlacementPolicy';
import { isOccupiedCensusPatient as isOccupied } from './censusReconciliationPredicates';
import {
  appendActiveBedPlacementIntents,
  reconcileActiveBedAssignments,
} from './gestionCamasActiveBedPolicy';
import { createEmptyCensusImportDiff } from './censusImportDiffFactory';
import { preparePavilionRecoverySyncScope } from './pavilionRecoverySyncPolicy';
import { prepareEquivalentBedSourceCollisions } from './bedOccupancyCollisionPolicy';
import {
  appendMissingFichaSignals,
  createDischargedEncounterMatcher,
} from './censusDischargeHistory';
export { requiresReview } from './censusReconciliationPredicates';
export interface ReconcileOptions {
  reference?: Date;
}
export const reconcileCensus = (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  options: ReconcileOptions = {}
): CensusImportDiff => {
  const reference = options.reference ?? new Date();
  const censusDay = toIsoCensusDay(current.date);
  const { occupiedBedIds, findCurrent, findCurrentCrib } = createCensusPatientIdentityIndex(
    current,
    snapshot.encounters
  );
  const wasDischargedInHhr = createDischargedEncounterMatcher(current);
  const diff: CensusImportDiff = createEmptyCensusImportDiff(snapshot.isComplete === true);
  const consumedBedIds = new Set<string>();
  const confirmedPrincipalBedIds = new Set<string>();
  const claimedTargets = new Map<string, string>(); // incoming admission/transfer targets
  let feasibleMoveSourceBedIds: ReadonlySet<string> = new Set();
  const claimTarget = (bedId: string, patientName: string, source: RayenEncounter): boolean => {
    const existing = claimedTargets.get(bedId);
    if (existing) {
      confirmedPrincipalBedIds.delete(bedId);
      diff.conflicts.push({
        bedId,
        patientName,
        code: 'principal-bed-collision',
        reason: `Dos pacientes de Rayen apuntan a la misma cama ${bedId} (${existing} y ${patientName}).`,
        source,
      });
      return false;
    }
    claimedTargets.set(bedId, patientName);
    return true;
  };
  // Place a Rayen patient into their mapped bed as an admission, if the target is free. `isCma`
  // remains transient source provenance for explicit first-sync review; it never changes the real
  // HHR bed or persists the patient as a CMA movement before the administrative discharge.
  const tryAdmit = (
    encounter: RayenEncounter,
    patient: PatientData,
    bedId: string,
    isCmaSource: boolean
  ): boolean => {
    if (!claimTarget(bedId, patient.patientName, encounter)) return false;
    const conflict = occupiedLocalBedConflict(current, bedId, patient, encounter);
    if (conflict && !feasibleMoveSourceBedIds.has(bedId)) {
      diff.conflicts.push({
        ...conflict,
        blockedAdmission: { bedId, patient, isCma: isCmaSource, source: encounter },
      });
      return false;
    }
    diff.admissions.push({ bedId, patient, isCma: isCmaSource, source: encounter });
    return true;
  };
  const activeScope = preparePavilionRecoverySyncScope(
    snapshot,
    current,
    occupiedBedIds,
    findCurrent
  );
  const active = activeScope.activeEncounters;
  const discharged = activeScope.dischargedEncounters;
  const { snapshotEpisodeIds, activeBedByEpisode } = activeScope;
  diff.activeClinicalEpisodeIds = activeScope.activeClinicalEpisodeIds;
  activeScope.ignoredLocalBedIds.forEach(bedId => consumedBedIds.add(bedId));
  const activeMapped = prepareActiveClinicalPlacements(
    current,
    active,
    snapshot.encounters,
    reference,
    findCurrent,
    findCurrentCrib
  );
  const activePrincipals = activeMapped.filter(item =>
    shouldReconcileAsPrincipal(item, findCurrent, wasDischargedInHhr)
  );
  const eligibleActivePrincipals = activePrincipals.filter(
    ({ encounter }) =>
      Boolean(findCurrent(encounter)) ||
      (!admittedAfterCensusDay(encounter, censusDay) && !wasDischargedInHhr(encounter))
  );
  const principalPlacements = prepareEquivalentBedSourceCollisions({
    current,
    placements: eligibleActivePrincipals,
    findCurrent,
    diff,
    consumedBedIds,
  });
  const principalPlacementIntents = principalPlacements.flatMap(({ encounter, mapped }) => {
    const match = findCurrent(encounter);
    if (!match && (admittedAfterCensusDay(encounter, censusDay) || wasDischargedInHhr(encounter)))
      return [];
    if (!mapped.bedId) return [];
    return [{ sourceBedId: match?.bedId, targetBedId: mapped.bedId }];
  });
  for (const encounter of discharged) {
    const match = findCurrent(encounter);
    if (!match) continue;
    const mapped = rayenToPatientData(encounter, reference);
    principalPlacementIntents.push({
      sourceBedId: match.bedId,
      targetBedId: encounter.verifiedBedPlacement && mapped.bedId ? mapped.bedId : match.bedId,
    });
  }
  appendActiveBedPlacementIntents(
    current,
    snapshotEpisodeIds,
    activeBedByEpisode,
    principalPlacementIntents
  );
  feasibleMoveSourceBedIds = feasiblePrincipalMoveSourceBedIds(
    principalPlacementIntents,
    occupiedBedIds
  );
  const retainedClosedCribs: typeof activeMapped = [];
  const trackClinicalClosure = (bedId: string, patient: PatientData, encounter: RayenEncounter) => {
    diff.pendingAdministrativeDischarges.push({
      bedId,
      rut: patient.rut,
      patientName: patient.patientName,
      signal: 'clinical-closure',
      encounterId: encounter.encounterId,
      verification: {
        medicalEpicrisis: stateFromBoolean(encounter.hasMedicalDischarge),
        nursingEpicrisis: stateFromBoolean(encounter.hasNurseDischarge),
        hospitalDischarge: 'unknown',
      },
      source: encounter,
    });
  };
  for (const { encounter, mapped } of principalPlacements) {
    const { patient, bedId } = mapped;
    const match = findCurrent(encounter);
    if (!match && wasDischargedInHhr(encounter)) continue;
    const movingNestedCrib =
      bedId && !mapped.isClinicalCrib ? findCurrentCrib(encounter) : undefined;
    if (movingNestedCrib) {
      diff.conflicts.push({
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        scope: 'clinical-crib',
        neonatalAssociationReview: true,
        reason: `El recién nacido sigue asociado a ${movingNestedCrib.bedId}; su traslado a ${bedId} requiere revisión.`,
        source: encounter,
      });
      continue;
    }
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
        if (!claimTarget(bedId, patient.patientName, encounter)) continue;
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
        if (!feasibleMoveSourceBedIds.has(match.bedId)) {
          diff.conflicts.push(
            blockedPrincipalMoveConflict(current, match.bedId, bedId, patient, encounter)
          );
          continue;
        }
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
    if (admittedAfterCensusDay(encounter, censusDay)) continue;
    if (tryAdmit(encounter, patient, bedId, mapped.isCma)) confirmedPrincipalBedIds.add(bedId);
  }
  reconcileActiveBedAssignments({
    current,
    snapshotEpisodeIds,
    activeBedByEpisode,
    consumedBedIds,
    feasibleMoveSourceBedIds,
    diff,
    claimTarget,
    confirmedPrincipalBedIds,
  });
  // Clinical closure never vacates a bed; Gestión de Camas must confirm statistical discharge.
  const closedMapped = prepareActiveClinicalPlacements(
    current,
    discharged,
    snapshot.encounters,
    reference,
    findCurrent,
    findCurrentCrib
  );
  for (const item of closedMapped) {
    const { encounter, mapped, maternalAssociationConflict, usesMaternalRun } = item;
    const promotedMatch = findCurrent(encounter);
    const existingCribMatch = findCurrentCrib(encounter);
    const isPromotedPrincipal = promotedMatch?.patient.bedMode === 'Cuna';
    if (mapped.isClinicalCrib || existingCribMatch) {
      if (!isPromotedPrincipal) {
        if (wasDischargedInHhr(encounter)) continue;
        if (admittedAfterCensusDay(encounter, censusDay)) continue;
        if (maternalAssociationConflict) {
          retainedClosedCribs.push({
            encounter,
            mapped,
            maternalAssociationConflict,
            usesMaternalRun,
          });
          continue;
        }
        const priorParentBedId = existingCribMatch?.bedId;
        const outgoingParentMove = priorParentBedId
          ? diff.moves.find(entry => entry.fromBedId === priorParentBedId)
          : undefined;
        const parentBedId = mapped.bedId ?? outgoingParentMove?.toBedId ?? priorParentBedId;
        const parent = parentBedId ? current.beds[parentBedId] : undefined;
        const parentAdmission = diff.admissions.find(entry => entry.bedId === parentBedId);
        const parentMove = diff.moves.find(entry => entry.toBedId === parentBedId);
        const movingParent = parentMove ? current.beds[parentMove.fromBedId] : undefined;
        const effectiveParent = parentAdmission?.patient ?? movingParent ?? parent;
        if (parentBedId && (existingCribMatch || isOccupied(effectiveParent))) {
          const retainedMapped = {
            ...mapped,
            bedId: parentBedId,
            isClinicalCrib: true,
            patient: {
              ...mapped.patient,
              bedId: parentBedId,
              bedMode: 'Cuna' as const,
            },
          };
          retainedClosedCribs.push({
            encounter,
            mapped: retainedMapped,
            maternalAssociationConflict,
            usesMaternalRun,
          });
          trackClinicalClosure(
            parentBedId,
            existingCribMatch?.patient ?? mapped.patient,
            encounter
          );
        }
        continue;
      }
    }
    const match = findCurrent(encounter);
    if (match) {
      if (consumedBedIds.has(match.bedId)) continue;
      consumedBedIds.add(match.bedId);
      const verifiedTargetBedId = encounter.verifiedBedPlacement ? mapped.bedId : null;
      const targetClaimed =
        !!verifiedTargetBedId && verifiedTargetBedId !== match.bedId
          ? claimTarget(verifiedTargetBedId, match.patient.patientName, encounter)
          : false;
      const placement = planVerifiedClosedBedMove({
        current,
        encounter,
        patient: match.patient,
        sourceBedId: match.bedId,
        targetBedId: verifiedTargetBedId,
        targetClaimed,
        feasibleMoveSourceBedIds,
      });
      if (placement.move) {
        diff.moves.push(placement.move);
        confirmedPrincipalBedIds.add(placement.retainedBedId);
      }
      if (placement.conflict) diff.conflicts.push(placement.conflict);
      // Old Ficha responses may omit room/bed on closure. An omitted location is compatible with
      // the matched local patient. A different location is accepted only when the official patient
      // flow report confirms it; otherwise the local placement stays review-gated.
      if (!mapped.bedId || mapped.bedId === match.bedId) {
        confirmedPrincipalBedIds.add(match.bedId);
      }
      trackClinicalClosure(placement.retainedBedId, match.patient, encounter);
      continue;
    }
    // A movement already recorded in HHR remains an explicit local decision. Otherwise, restore
    // the clinically closed encounter if its bed can be resolved; the administrative report may
    // later replace that provisional admission with the definitive statistical movement.
    if (wasDischargedInHhr(encounter)) continue;
    const { patient, bedId } = mapped;
    if (bedId) {
      // Evidence belongs to the episode even when a replacement already occupies its old bed.
      trackClinicalClosure(bedId, patient, encounter);
      if (tryAdmit(encounter, patient, bedId, mapped.isCma)) confirmedPrincipalBedIds.add(bedId);
    }
  }
  const finalizedAdmissions = finalizeAdmissionsAgainstAcceptedMoves(
    current,
    diff.admissions,
    diff.moves
  );
  diff.admissions = finalizedAdmissions.admissions;
  diff.conflicts.push(...finalizedAdmissions.conflicts);
  for (const conflict of finalizedAdmissions.conflicts) {
    if (conflict.bedId) confirmedPrincipalBedIds.delete(conflict.bedId);
  }
  // Resolve cribs after principals so provisional admissions can receive their newborn.
  reconcileClinicalCribs(
    current,
    [
      ...activeMapped.filter(
        item =>
          item.mapped.isClinicalCrib &&
          !shouldReconcileAsPrincipal(item, findCurrent, wasDischargedInHhr) &&
          !wasDischargedInHhr(item.encounter) &&
          !admittedAfterCensusDay(item.encounter, censusDay)
      ),
      ...retainedClosedCribs,
    ],
    diff,
    confirmedPrincipalBedIds,
    pendingClinicalCribDischargeIdentities(retainedClosedCribs)
  );
  // Ficha absence signals a pending check, never a statistical movement.
  if (snapshot.isComplete === true)
    appendMissingFichaSignals(current, diff, occupiedBedIds, consumedBedIds);
  planReviewedNeonatalSourceChanges(current, diff, [...active, ...discharged]);
  diff.neonatalPlacementReviews = prepareNeonatalPlacementReviews(current, diff, [
    ...activeMapped,
    ...closedMapped,
  ]);
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
