import { neonatalMaternalLookupRut } from './neonatalMaternalLookupIdentity';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { mapRayenBed } from '../mapping/bedMapping';

export const neonatalSourcePlacementKey = (source: RayenEncounter): string => {
  const p = mapRayenBed(source);
  return `${p.bedId ?? ''}:${p.isClinicalCrib ? 'cuna' : p.isCma ? 'cma' : 'cama'}`;
};

/** Same corrected placement is acknowledged without another bed decision.
 * A later different source placement always gates automatic persistence on human review. */
export const planReviewedNeonatalSourceChanges = (
  current: DailyRecord,
  diff: CensusImportDiff,
  sources: RayenEncounter[]
): void => {
  for (const [bedId, principal] of Object.entries(current.beds)) {
    for (const patient of [principal, principal.clinicalCrib]) {
      const decision = patient?.neonatalPlacementDecision;
      if (!patient || !decision || decision.clinicalEpisodeId !== patient.clinicalEpisodeId)
        continue;
      const source = sources.find(s => s.encounterId === decision.clinicalEpisodeId);
      if (!source) continue;
      const placement = mapRayenBed(source);
      if (!placement.bedId) continue;
      const key = neonatalSourcePlacementKey(source);
      if (
        diff.conflicts.some(
          c => c.neonatalAssociationReview && c.source?.encounterId === source.encounterId
        )
      )
        continue;
      const maternalRut =
        decision.kind === 'mother'
          ? principal.clinicalEpisodeId === decision.parentEpisodeId
            ? principal.rut
            : decision.maternalRut
          : neonatalMaternalLookupRut(current, sources, source.encounterId, source.run);
      const runKey = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase();
      if (
        key === decision.sourcePlacementKey &&
        runKey(source.run) === runKey(decision.sourceRun ?? '') &&
        (!maternalRut || maternalRut === decision.maternalRut)
      )
        continue;
      const nested = patient !== principal;
      if (!nested && placement.isClinicalCrib && key !== decision.sourcePlacementKey) {
        diff.conflicts.push({
          bedId,
          rut: patient.rut,
          patientName: patient.patientName,
          reason: 'Confirma la ubicación del RN: Eloísa ahora informa una cuna.',
          source,
          scope: 'clinical-crib',
          neonatalAssociationReview: true,
        });
        continue;
      }

      const movingParent = nested && diff.moves.find(m => m.fromBedId === bedId);
      const targetBedId = movingParent ? movingParent.toBedId : bedId;
      const matches =
        placement.bedId === targetBedId &&
        (nested
          ? placement.isClinicalCrib
          : !placement.isClinicalCrib && !placement.isCma && patient.bedMode === 'Cama');
      if (!matches && key !== decision.sourcePlacementKey) {
        (diff.neonatalSourceChanges ??= []).push({
          episodeId: source.encounterId,
          patientName: patient.patientName,
          hhrBedId: targetBedId,
          sourceBedId: placement.bedId,
          sourceMode: placement.isClinicalCrib ? 'Cuna' : placement.isCma ? 'CMA' : 'Cama',
          hhrMode: nested ? 'Cuna' : (patient.bedMode ?? 'Cama'),
        });
      }
      // Cross-mode transitions use the explicit RN placement form, never a duplicate admission.
      if (nested && !placement.isClinicalCrib) continue;
      const rootMove = nested
        ? undefined
        : diff.moves.find(
            m => m.fromBedId === bedId && m.source.encounterId === source.encounterId
          );
      const updateBedId = rootMove?.toBedId ?? targetBedId;
      const nextDecision = {
        ...decision,
        sourcePlacementKey: key,
        sourceRun: source.run,
        sourceRunIsMaternal:
          Boolean(neonatalMaternalLookupRut(current, sources, source.encounterId, source.run)) ||
          Boolean(maternalRut && runKey(maternalRut) === runKey(source.run)) ||
          Boolean(
            decision.sourceRunIsMaternal && runKey(decision.sourceRun ?? '') === runKey(source.run)
          ),
        bedId: updateBedId,
        ...(maternalRut ? { maternalRut } : {}),
      };
      let changes: CensusImportDiff['updates'][number]['changes'];
      if (nested) {
        const existingUpdate = diff.updates.find(
          u =>
            u.bedId === updateBedId &&
            u.changes.some(
              c =>
                c.field === 'clinicalCrib' &&
                (c.to as PatientData | undefined)?.clinicalEpisodeId === patient.clinicalEpisodeId
            )
        );
        if (existingUpdate) {
          existingUpdate.changes = existingUpdate.changes.map(c =>
            c.field === 'clinicalCrib'
              ? { ...c, to: { ...(c.to as PatientData), neonatalPlacementDecision: nextDecision } }
              : c
          );
          continue;
        }
        changes = [
          {
            field: 'clinicalCrib',
            from: patient,
            to: { ...patient, bedId: updateBedId, neonatalPlacementDecision: nextDecision },
          },
        ];
      } else changes = [{ field: 'neonatalPlacementDecision', from: decision, to: nextDecision }];
      diff.updates.push({
        bedId: updateBedId,
        rut: principal.rut,
        patientName: principal.patientName,
        patient: principal,
        source,
        changes,
      });
    }
  }
};

/** A separate per-RN acknowledgement gates later source-location proposals. CAS compares the exact plan again. */
export const assertNeonatalSourceChangesReviewed = (
  diff: CensusImportDiff,
  acceptedEpisodes: string[]
): void => {
  if ((diff.neonatalSourceChanges ?? []).some(c => !acceptedEpisodes.includes(c.episodeId)))
    throw new Error('Confirma cada cambio de ubicación del RN antes de aplicar el censo.');
};
