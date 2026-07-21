import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { MappedPatient } from '../mapping/rayenToPatientData';
import { diffSyncablePatientFields, mergeSyncablePatient } from './patientSyncPolicy';

interface ClinicalCribCandidate {
  encounter: RayenEncounter;
  mapped: MappedPatient;
}

interface CurrentClinicalCribRef {
  parentBedId: string;
  patient: PatientData;
}

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

const indexCurrentClinicalCribs = (current: DailyRecord) => {
  const byEpisode = new Map<string, CurrentClinicalCribRef>();
  const byRut = new Map<string, CurrentClinicalCribRef>();
  for (const [parentBedId, parent] of Object.entries(current.beds)) {
    if (!isOccupied(parent?.clinicalCrib)) continue;
    const patient = parent.clinicalCrib;
    const ref = { parentBedId, patient };
    if (patient.clinicalEpisodeId) byEpisode.set(patient.clinicalEpisodeId, ref);
    const rut = normalizeRut(patient.rut);
    if (rut) byRut.set(rut, ref);
  }
  return { byEpisode, byRut };
};

/**
 * Reconciles occupied physical cribs as nested HHR clinical cribs.
 * It mutates only the supplied diff accumulator and never persists data.
 */
export const reconcileClinicalCribs = (
  current: DailyRecord,
  candidates: ClinicalCribCandidate[],
  diff: CensusImportDiff,
  confirmedPrincipalBedIds: ReadonlySet<string>,
  pendingDischargeIdentities: ReadonlySet<string> = new Set()
): void => {
  const currentCribs = indexCurrentClinicalCribs(current);
  const claimsByParent = new Map<string, number>();
  for (const { mapped } of candidates) {
    if (mapped.bedId) claimsByParent.set(mapped.bedId, (claimsByParent.get(mapped.bedId) ?? 0) + 1);
  }
  const reportedDuplicateParents = new Set<string>();

  for (const { encounter, mapped } of candidates) {
    const { patient: incomingCrib } = mapped;
    const existingRef = currentCribs.byEpisode.get(encounter.encounterId) ??
      currentCribs.byRut.get(normalizeRut(incomingCrib.rut));
    const retainedParentMove = !encounter.clinicalCribParentBedId && existingRef?.parentBedId === mapped.bedId
      ? diff.moves.find(entry => entry.fromBedId === mapped.bedId) : undefined;
    const parentBedId = retainedParentMove?.toBedId ?? mapped.bedId;
    if (!parentBedId) continue;
    if ((claimsByParent.get(parentBedId) ?? 0) > 1) {
      if (reportedDuplicateParents.has(parentBedId)) continue;
      reportedDuplicateParents.add(parentBedId);
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        scope: 'clinical-crib',
        reason: `Dos recién nacidos de Rayen apuntan a la cuna clínica de ${parentBedId}.`,
        source: encounter,
      });
      continue;
    }
    const parentMove = diff.moves.find(entry => entry.toBedId === parentBedId);
    const movingParent = parentMove ? current.beds[parentMove.fromBedId] : undefined;
    const parentAdmission = diff.admissions.find(entry => entry.bedId === parentBedId);
    const currentParent = current.beds[parentBedId];
    const incomingPrincipalConflict = [...diff.conflicts].reverse().find(entry =>
      entry.bedId === parentBedId &&
      normalizeRut(entry.rut) !== normalizeRut(incomingCrib.rut) &&
      entry.source
    );
    const principalRut =
      parentAdmission?.patient.rut ??
      movingParent?.rut ??
      incomingPrincipalConflict?.source?.run ??
      incomingPrincipalConflict?.rut ??
      currentParent?.rut;
    const recordActiveCrib = (): void => {
      (diff.activeClinicalCribs ??= []).push({
        parentBedId,
        principalRut,
        patient: incomingCrib,
        source: encounter,
      });
    };
    const existingCrib = currentCribs.byEpisode.get(encounter.encounterId) ??
      currentCribs.byRut.get(normalizeRut(encounter.run));
    const cribMovesWithParent = !!parentMove && existingCrib?.parentBedId === parentMove.fromBedId;
    if (existingCrib && existingCrib.parentBedId !== parentBedId && !cribMovesWithParent) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        scope: 'clinical-crib',
        reason: `La cuna clínica ya está asociada a ${existingCrib.parentBedId}; el cambio requiere revisión.`,
        source: encounter,
      });
      continue;
    }
    if (!confirmedPrincipalBedIds.has(parentBedId)) {
      recordActiveCrib();
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        scope: 'clinical-crib',
        code: 'unconfirmed-principal-bed',
        reason: `La cama principal ${parentBedId} no fue confirmada en el censo activo de Rayen.`,
        source: encounter,
      });
      continue;
    }

    const outgoingParentMove = diff.moves.find(entry => entry.fromBedId === parentBedId);
    const reparentsExistingCrib = !!existingCrib && !!outgoingParentMove &&
      (!!parentMove || !!parentAdmission) && !cribMovesWithParent;
    const outgoingParent = outgoingParentMove ? current.beds[outgoingParentMove.fromBedId] : undefined;
    const outgoingCribUpdate: CensusImportDiff['updates'][number] | undefined =
      reparentsExistingCrib && isOccupied(outgoingParent)
        ? {
            bedId: outgoingParentMove.toBedId,
            rut: outgoingParent.rut,
            patientName: outgoingParent.patientName,
            changes: [{ field: 'clinicalCrib', from: existingCrib.patient, to: undefined }],
            patient: outgoingParent,
            source: outgoingParentMove.source,
        }
        : undefined;
    const reparentedCrib = existingCrib
      ? {
          ...mergeSyncablePatient(existingCrib.patient, incomingCrib),
          bedId: parentBedId,
          clinicalEpisodeId:
            incomingCrib.clinicalEpisodeId || existingCrib.patient.clinicalEpisodeId,
        }
      : incomingCrib;
    if (existingCrib && !reparentsExistingCrib) {
      const existingParent = current.beds[existingCrib.parentBedId];
      if (!isOccupied(existingParent)) {
        diff.conflicts.push({
          bedId: parentBedId,
          rut: incomingCrib.rut,
          patientName: incomingCrib.patientName,
          scope: 'clinical-crib',
          reason: `La cuna clínica de ${parentBedId} no tiene una cama principal ocupada en HHR.`,
          source: encounter,
        });
        continue;
      }
      const childChanges = diffSyncablePatientFields(existingCrib.patient, incomingCrib);
      const clearsLegacyFlag = existingParent.hasCompanionCrib === true;
      if (childChanges.length === 0 && !clearsLegacyFlag) {
        const identity = encounter.encounterId
          ? `episode:${encounter.encounterId}` : `run:${normalizeRut(incomingCrib.rut)}`;
        if (!pendingDischargeIdentities.has(identity)) {
          diff.unchangedCount += 1;
        }
      } else {
        const mergedCrib = mergeSyncablePatient(existingCrib.patient, incomingCrib);
        if (incomingCrib.clinicalEpisodeId) {
          mergedCrib.clinicalEpisodeId = incomingCrib.clinicalEpisodeId;
        }
        diff.updates.push({
          bedId: parentBedId,
          rut: incomingCrib.rut,
          patientName: incomingCrib.patientName,
          changes: [
            ...(childChanges.length > 0 ? [{
              field: 'clinicalCrib' as const,
              from: existingCrib.patient,
              to: mergedCrib,
            }] : []),
            ...(clearsLegacyFlag ? [{
              field: 'hasCompanionCrib' as const,
              from: true,
              to: false,
            }] : []),
          ],
          patient: existingParent,
          source: encounter,
        });
      }
      recordActiveCrib();
      continue;
    }

    if (parentAdmission) {
      parentAdmission.patient = {
        ...parentAdmission.patient,
        hasCompanionCrib: false,
        clinicalCrib: reparentedCrib,
      };
      if (outgoingCribUpdate) diff.updates.push(outgoingCribUpdate);
      recordActiveCrib();
      continue;
    }
    const effectiveParent = parentMove ? movingParent : currentParent;
    if (!isOccupied(effectiveParent)) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        scope: 'clinical-crib',
        reason: `La cuna clínica ${parentBedId} no tiene una cama principal ocupada en HHR.`,
        source: encounter,
      });
      continue;
    }
    if (isOccupied(effectiveParent.clinicalCrib)) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        scope: 'clinical-crib',
        reason: `La cuna clínica de ${parentBedId} ya está ocupada por ${effectiveParent.clinicalCrib.patientName}.`,
        source: encounter,
      });
      continue;
    }
    if (outgoingCribUpdate) diff.updates.push(outgoingCribUpdate);
    diff.updates.push({
      bedId: parentBedId,
      rut: incomingCrib.rut,
      patientName: incomingCrib.patientName,
      changes: [
        { field: 'clinicalCrib', from: effectiveParent.clinicalCrib, to: reparentedCrib },
        ...(effectiveParent.hasCompanionCrib ? [{
          field: 'hasCompanionCrib' as const,
          from: true,
          to: false,
        }] : []),
      ],
      patient: effectiveParent,
      source: encounter,
    });
    recordActiveCrib();
  }
};
