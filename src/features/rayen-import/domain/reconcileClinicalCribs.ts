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
  confirmedPrincipalBedIds: ReadonlySet<string>
): void => {
  const currentCribs = indexCurrentClinicalCribs(current);
  const claimedParents = new Set<string>();

  for (const { encounter, mapped } of candidates) {
    const { patient: incomingCrib, bedId: parentBedId } = mapped;
    if (!parentBedId) continue;
    if (claimedParents.has(parentBedId)) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        reason: `Dos recién nacidos de Rayen apuntan a la cuna clínica de ${parentBedId}.`,
        source: encounter,
      });
      continue;
    }
    claimedParents.add(parentBedId);
    if (!confirmedPrincipalBedIds.has(parentBedId)) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        reason: `La cama principal ${parentBedId} no fue confirmada en el censo activo de Rayen.`,
        source: encounter,
      });
      continue;
    }

    const parentMove = diff.moves.find(entry => entry.toBedId === parentBedId);
    const movingParent = parentMove ? current.beds[parentMove.fromBedId] : undefined;
    const existingCrib = currentCribs.byEpisode.get(encounter.encounterId) ??
      currentCribs.byRut.get(normalizeRut(encounter.run));
    const cribMovesWithParent = !!parentMove && existingCrib?.parentBedId === parentMove.fromBedId;
    if (existingCrib && existingCrib.parentBedId !== parentBedId && !cribMovesWithParent) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
        reason: `La cuna clínica ya está asociada a ${existingCrib.parentBedId}; el cambio requiere revisión.`,
        source: encounter,
      });
      continue;
    }

    const parentAdmission = diff.admissions.find(entry => entry.bedId === parentBedId);
    const currentParent = current.beds[parentBedId];
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
    if (existingCrib && !reparentsExistingCrib) {
      const existingParent = current.beds[existingCrib.parentBedId];
      if (!isOccupied(existingParent)) {
        diff.conflicts.push({
          bedId: parentBedId,
          rut: incomingCrib.rut,
          patientName: incomingCrib.patientName,
          reason: `La cuna clínica de ${parentBedId} no tiene una cama principal ocupada en HHR.`,
          source: encounter,
        });
        continue;
      }
      const childChanges = diffSyncablePatientFields(existingCrib.patient, incomingCrib);
      if (
        incomingCrib.clinicalEpisodeId &&
        existingCrib.patient.clinicalEpisodeId !== incomingCrib.clinicalEpisodeId
      ) {
        childChanges.push({
          field: 'clinicalEpisodeId',
          from: existingCrib.patient.clinicalEpisodeId,
          to: incomingCrib.clinicalEpisodeId,
        });
      }
      const clearsLegacyFlag = existingParent.hasCompanionCrib === true;
      if (childChanges.length === 0 && !clearsLegacyFlag) {
        diff.unchangedCount += 1;
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
      continue;
    }

    if (parentAdmission) {
      parentAdmission.patient = {
        ...parentAdmission.patient,
        hasCompanionCrib: false,
        clinicalCrib: incomingCrib,
      };
      if (outgoingCribUpdate) diff.updates.push(outgoingCribUpdate);
      continue;
    }
    const effectiveParent = parentMove ? movingParent : currentParent;
    if (!isOccupied(effectiveParent)) {
      diff.conflicts.push({
        bedId: parentBedId,
        rut: incomingCrib.rut,
        patientName: incomingCrib.patientName,
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
        { field: 'clinicalCrib', from: effectiveParent.clinicalCrib, to: incomingCrib },
        ...(effectiveParent.hasCompanionCrib ? [{
          field: 'hasCompanionCrib' as const,
          from: true,
          to: false,
        }] : []),
      ],
      patient: effectiveParent,
      source: encounter,
    });
  }
};
