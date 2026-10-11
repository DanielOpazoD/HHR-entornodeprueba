import { EMPTY_PATIENT } from '@/constants/patient';
import { isMaternalCandidatePatient } from './clinicalCribMaternalAssociation';
import { occupied, plannedCribOccupied } from './neonatalPlacementAvailability';
import { neonatalSourcePlacementKey } from './reviewedNeonatalSourcePlacement';
import { isValidRut } from '@/utils/rutUtils';
import type { NeonatalPlacementDecision } from '@/types/domain/neonatalPlacementDecision';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

import type { NeonatalPlacementResolution } from '../contracts/neonatalPlacementReview';
/** Apply only explicit decisions to the reviewed transient plan. Recomputed against fresh CAS bases. */
export const resolveNeonatalPlacements = (
  current: DailyRecord,
  diff: CensusImportDiff,
  choices: NeonatalPlacementResolution[],
  reviewedAt: string,
  reviewedBy: string
): CensusImportDiff => {
  const reviews = diff.neonatalPlacementReviews ?? [];
  if (reviews.some(r => choices.filter(c => c.episodeId === r.episodeId).length !== 1))
    throw new Error('Resuelve cada RN o indica que se revisará después.');
  if (!choices.length) return diff;
  if (!Number.isFinite(Date.parse(reviewedAt)) || !reviewedBy.trim())
    throw new Error('La confirmación del RN requiere fecha y responsable.');
  const next: CensusImportDiff = {
    ...diff,
    admissions: [...diff.admissions],
    updates: [...diff.updates],
    moves: [...diff.moves],
    conflicts: [...diff.conflicts],
  };
  // All exact reviewed nested episodes are released in the transient plan before
  // any attachment, so swaps/chains cannot depend on the order of selections.
  for (const choice of choices) {
    if (choice.kind === 'deferred') continue;
    const review = reviews.find(r => r.episodeId === choice.episodeId);
    if (!review || review.existingKind !== 'mother' || !review.existingBedId) continue;
    const nestedParent = current.beds[review.existingBedId];
    const existing = nestedParent?.clinicalCrib;
    if (existing?.clinicalEpisodeId !== choice.episodeId)
      throw new Error('La asociación del RN cambió; vuelve a revisar.');
    {
      const parentBed =
        next.moves.find(m => m.fromBedId === review.existingBedId)?.toBedId ??
        review.existingBedId!;
      next.updates = next.updates.flatMap(u => {
        if (u.bedId !== parentBed) return [u];
        const changes = u.changes.filter(c => c.field !== 'clinicalCrib');
        return changes.length ? [{ ...u, changes }] : [];
      });
      next.updates.push({
        bedId: parentBed,
        rut: nestedParent.rut,
        patientName: nestedParent.patientName,
        patient: nestedParent,
        source: review.source,
        changes: [{ field: 'clinicalCrib', from: existing, to: undefined }],
      });
      next.activeClinicalCribs = next.activeClinicalCribs?.filter(
        c => c.patient.clinicalEpisodeId !== choice.episodeId
      );
    }
  }
  const claimed = new Set<string>();
  const episodes = new Set<string>();
  const orderedChoices = [...choices].sort(
    (a, b) =>
      Number(Boolean(reviews.find(r => r.episodeId === b.episodeId)?.existingBedId)) -
      Number(Boolean(reviews.find(r => r.episodeId === a.episodeId)?.existingBedId))
  );
  for (const choice of orderedChoices) {
    const review = diff.neonatalPlacementReviews?.find(r => r.episodeId === choice.episodeId);
    if (!review || episodes.has(choice.episodeId))
      throw new Error('La ubicación del RN cambió; vuelve a revisar.');
    episodes.add(choice.episodeId);
    if (choice.kind === 'deferred') continue;
    if (claimed.has(choice.bedId))
      throw new Error('Dos RN usan el mismo destino; vuelve a revisar.');
    if (
      choice.kind === 'independent' &&
      (!review.independentBeds.includes(choice.bedId) ||
        review.unavailableIndependentBeds?.includes(choice.bedId))
    )
      throw new Error('La cama independiente no está disponible; vuelve a revisar.');
    claimed.add(choice.bedId);
    const nestedParent =
      review.existingKind === 'mother' && review.existingBedId
        ? current.beds[review.existingBedId]
        : undefined;
    const existing =
      nestedParent?.clinicalCrib ??
      (review.existingBedId ? current.beds[review.existingBedId] : undefined);
    if (nestedParent && existing?.clinicalEpisodeId !== choice.episodeId)
      throw new Error('La asociación del RN cambió; vuelve a revisar.');
    if (
      review.existingBedId &&
      !nestedParent &&
      (existing?.clinicalEpisodeId !== choice.episodeId ||
        existing.bedMode !== 'Cama' ||
        existing.isBlocked ||
        occupied(existing.clinicalCrib))
    )
      throw new Error('La cama independiente del RN cambió; vuelve a revisar.');
    if (
      !existing &&
      Object.values(current.beds).some(
        p =>
          p.clinicalEpisodeId === choice.episodeId ||
          p.clinicalCrib?.clinicalEpisodeId === choice.episodeId
      )
    )
      throw new Error('El RN ya está ubicado; actualiza la revisión antes de confirmar.');
    const mother =
      choice.kind === 'mother'
        ? review.mothers.find(
            m => m.bedId === choice.bedId && m.episodeId === choice.parentEpisodeId
          )
        : undefined;
    if (choice.kind === 'mother' && !mother)
      throw new Error('La madre seleccionada ya no está disponible.');
    const effectiveAt = choice.kind === 'independent' ? choice.effectiveAt : reviewedAt;
    if (
      !effectiveAt ||
      !Number.isFinite(Date.parse(effectiveAt)) ||
      Date.parse(effectiveAt) > Date.parse(reviewedAt)
    )
      throw new Error('Confirma desde cuándo el RN está hospitalizado en cama independiente.');
    const admissionAt = Date.parse(review.source.admissionDatetime || '');
    if (
      choice.kind === 'independent' &&
      (!Number.isFinite(admissionAt) || Date.parse(effectiveAt) < admissionAt)
    )
      throw new Error(
        'La hospitalización independiente no puede comenzar antes del ingreso del RN.'
      );
    const decision: NeonatalPlacementDecision = {
      clinicalEpisodeId: choice.episodeId,
      kind: choice.kind,
      bedId: choice.bedId,
      ...(mother ? { parentEpisodeId: mother.episodeId } : {}),
      effectiveAt,
      reviewedAt,
      reviewedBy,
      sourcePlacementKey: neonatalSourcePlacementKey(review.source),
      sourceService: review.source.service,
      sourceRun: review.source.run,
    };
    const runKey = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase();
    const maternalMatches = [
      ...Object.values(current.beds),
      ...next.admissions.map(a => a.patient),
    ].filter(
      p =>
        Boolean(p.clinicalEpisodeId) &&
        p.clinicalEpisodeId !== choice.episodeId &&
        isMaternalCandidatePatient(p) &&
        !p.isBlocked &&
        isValidRut(review.source.run) &&
        runKey(p.rut) === runKey(review.source.run)
    );
    const distinctMaternalEpisodes = new Set(maternalMatches.map(p => p.clinicalEpisodeId));
    const selectedMaternal = mother
      ? [...Object.values(current.beds), ...next.admissions.map(a => a.patient)].find(
          p =>
            p.clinicalEpisodeId === mother.episodeId &&
            isMaternalCandidatePatient(p) &&
            isValidRut(p.rut)
        )
      : undefined;
    const maternalRut = mother
      ? selectedMaternal?.rut
      : distinctMaternalEpisodes.size === 1 && maternalMatches.length
        ? maternalMatches[0].rut
        : undefined;
    decision.sourceRunIsMaternal = Boolean(
      (maternalMatches.length > 0 &&
        (distinctMaternalEpisodes.size === 1 ||
          runKey(review.patient.rut) !== runKey(review.source.run))) ||
      (maternalRut && runKey(maternalRut) === runKey(review.source.run)) ||
      (existing?.neonatalPlacementDecision?.sourceRunIsMaternal &&
        runKey(existing.neonatalPlacementDecision.sourceRun ?? '') === runKey(review.source.run))
    );
    const carriesMaternalRun = Boolean(
      ((distinctMaternalEpisodes.size === 1 && maternalMatches.length > 0) ||
        (maternalRut && runKey(maternalRut) === runKey(review.source.run)) ||
        (existing?.neonatalPlacementDecision?.sourceRunIsMaternal &&
          runKey(existing.neonatalPlacementDecision.sourceRun ?? '') ===
            runKey(review.source.run))) &&
      runKey(review.patient.rut) === runKey(review.source.run)
    );
    if (maternalRut) decision.maternalRut = maternalRut;
    else if (!mother && existing?.neonatalPlacementDecision?.maternalRut)
      decision.maternalRut = existing.neonatalPlacementDecision.maternalRut;
    const patient: PatientData = {
      ...review.patient,
      neonatalMaternalRut: mother
        ? decision.maternalRut
        : (decision.maternalRut ?? review.patient.neonatalMaternalRut),
      ...(carriesMaternalRun ? { rut: '', identityStatus: 'provisional' as const } : {}),
      bedId: choice.bedId,
      bedMode: choice.kind === 'mother' ? 'Cuna' : 'Cama',
      neonatalPlacementDecision: decision,
    };

    if (existing && !nestedParent && choice.kind === 'mother') {
      const oldBed = review.existingBedId!;
      next.moves = next.moves.filter(m => m.source.encounterId !== choice.episodeId);
      if (
        next.updates.some(
          u =>
            u.bedId === oldBed &&
            u.changes.length &&
            u.patient.clinicalEpisodeId !== choice.episodeId &&
            u.source?.encounterId !== choice.episodeId
        )
      )
        throw new Error('Hay otros cambios en la cama del RN; vuelve a revisar.');
      next.updates = next.updates.filter(u => u.bedId !== oldBed);
      next.updates.push({
        bedId: oldBed,
        rut: existing.rut,
        patientName: existing.patientName,
        patient: existing,
        source: review.source,
        changes: Object.keys(existing)
          .filter(k => k !== 'bedId')
          .map(k => ({
            field: k as keyof PatientData,
            from: existing[k as keyof PatientData],
            to: EMPTY_PATIENT[k as keyof typeof EMPTY_PATIENT],
          })),
      });
    }
    if (existing && !nestedParent && choice.kind === 'independent') {
      if (choice.bedId !== review.existingBedId) {
        next.moves = next.moves.filter(m => m.source.encounterId !== choice.episodeId);
        next.moves.push({
          fromBedId: review.existingBedId!,
          toBedId: choice.bedId,
          rut: existing.rut,
          patientName: existing.patientName,
          source: review.source,
        });
        next.updates = next.updates.map(u =>
          u.bedId === review.existingBedId ? { ...u, bedId: choice.bedId } : u
        );
      }
      next.updates.push({
        bedId: choice.bedId,
        rut: existing.rut,
        patientName: existing.patientName,
        patient: existing,
        source: review.source,
        changes: [
          ...(carriesMaternalRun
            ? [
                { field: 'rut' as const, from: existing.rut, to: '' },
                {
                  field: 'identityStatus' as const,
                  from: existing.identityStatus,
                  to: 'provisional',
                },
              ]
            : []),
          {
            field: 'neonatalPlacementDecision',
            from: existing.neonatalPlacementDecision,
            to: decision,
          },
        ],
      });
    } else if (choice.kind === 'mother') {
      let principalRut: string;
      if (!mother) throw new Error('La madre seleccionada ya no está disponible.');
      if (plannedCribOccupied(next, choice.bedId))
        throw new Error('La madre ya tiene una cuna asignada en esta sincronización.');
      const admission = next.admissions.find(
        a => a.bedId === choice.bedId && a.patient.clinicalEpisodeId === mother.episodeId
      );
      if (admission) {
        const destination = current.beds[choice.bedId];
        const vacates =
          destination?.clinicalEpisodeId &&
          (next.moves.some(
            m =>
              m.fromBedId === choice.bedId && m.source.encounterId === destination.clinicalEpisodeId
          ) ||
            next.discharges.some(
              d =>
                d.bedId === choice.bedId && d.source?.encounterId === destination.clinicalEpisodeId
            ));
        if (destination?.isBlocked || (occupied(destination) && !vacates))
          throw new Error(
            'La cama destino de la madre dejó de estar disponible; vuelve a revisar.'
          );
        principalRut = admission.patient.rut;
        if (!isMaternalCandidatePatient(admission.patient))
          throw new Error('El episodio seleccionado no corresponde a una madre.');
        if (occupied(admission.patient.clinicalCrib))
          throw new Error('La madre ya tiene una cuna ocupada.');
        next.admissions = next.admissions.map(a =>
          a === admission ? { ...a, patient: { ...a.patient, clinicalCrib: patient } } : a
        );
      } else {
        const move = next.moves.find(
          m => m.toBedId === choice.bedId && m.source.encounterId === mother.episodeId
        );
        const parent = current.beds[move?.fromBedId ?? choice.bedId];
        const destination = current.beds[choice.bedId];
        const cribReleased = next.updates.some(
          u =>
            u.bedId === choice.bedId &&
            u.changes.some(
              c =>
                c.field === 'clinicalCrib' &&
                c.to === undefined &&
                (c.from as PatientData | undefined)?.clinicalEpisodeId ===
                  parent?.clinicalCrib?.clinicalEpisodeId
            )
        );
        const destinationVacates = next.moves.some(
          m =>
            m.fromBedId === choice.bedId && m.source.encounterId === destination?.clinicalEpisodeId
        );
        if (destination?.isBlocked)
          throw new Error('La cama destino de la madre está bloqueada; vuelve a revisar.');
        if (
          move &&
          occupied(destination) &&
          !destinationVacates &&
          (destination?.clinicalEpisodeId !== mother.episodeId ||
            (occupied(destination.clinicalCrib) &&
              destination.clinicalCrib?.clinicalEpisodeId !== choice.episodeId))
        )
          throw new Error('La cama destino de la madre está ocupada; vuelve a revisar.');
        if (
          parent?.clinicalEpisodeId !== mother.episodeId ||
          !isMaternalCandidatePatient(parent) ||
          (occupied(parent.clinicalCrib) &&
            !cribReleased &&
            !(nestedParent && parent.clinicalCrib?.clinicalEpisodeId === choice.episodeId)) ||
          parent.isBlocked
        )
          throw new Error('La cama de la madre cambió; vuelve a revisar.');
        principalRut = parent.rut;
        next.updates.push({
          bedId: choice.bedId,
          rut: parent.rut,
          patientName: parent.patientName,
          patient: parent,
          changes: [
            { field: 'clinicalCrib', from: undefined, to: patient },
            { field: 'hasCompanionCrib', from: parent.hasCompanionCrib, to: false },
          ],
          source: review.source,
        });
      }
      next.activeClinicalCribs = [
        ...(next.activeClinicalCribs ?? []),
        {
          parentBedId: choice.bedId,
          principalRut,
          patient,
          source: review.source,
        },
      ];
    } else {
      if (
        !review.independentBeds.includes(choice.bedId) ||
        occupied(current.beds[choice.bedId]) ||
        next.admissions.some(a => a.bedId === choice.bedId) ||
        next.moves.some(m => m.toBedId === choice.bedId)
      )
        throw new Error('La cama independiente dejó de estar disponible.');
      next.admissions.push({ bedId: choice.bedId, patient, isCma: false, source: review.source });
    }
    next.conflicts = next.conflicts.filter(
      f => !(f.neonatalAssociationReview === true && f.source?.encounterId === choice.episodeId)
    );
  }
  next.neonatalPlacementReviews = diff.neonatalPlacementReviews?.filter(
    r => !choices.some(c => c.episodeId === r.episodeId && c.kind !== 'deferred')
  );
  next.summary = {
    ...next.summary,
    admissions: next.admissions.length,
    updates: next.updates.length,
    moves: next.moves.length,
    conflicts: next.conflicts.length,
  };
  return next;
};
