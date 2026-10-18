import { isDischargedEncounter } from './censusReconciliationPredicates';
import { BEDS } from '@/constants/beds';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import {
  withClinicalCribDefaults,
  type MappedClinicalEncounter,
} from './clinicalCribPlacementPolicy';
import { mergeSyncablePatient } from './patientSyncPolicy';
import type {
  NeonatalPlacementReview,
  NeonatalPlacementResolution,
} from '../contracts/neonatalPlacementReview';
import { isMaternalCandidatePatient } from './clinicalCribMaternalAssociation';
import { occupied } from './neonatalPlacementAvailability';
export const prepareNeonatalPlacementReviews = (
  current: DailyRecord,
  diff: CensusImportDiff,
  candidates: MappedClinicalEncounter[]
): NeonatalPlacementReview[] => {
  const known = new Set(
    Object.values(current.beds).flatMap(p =>
      [p.clinicalEpisodeId, p.clinicalCrib?.clinicalEpisodeId].filter(Boolean)
    )
  );
  const principals = candidates.filter(
    c =>
      !c.mapped.isClinicalCrib &&
      c.mapped.bedId &&
      (!isDischargedEncounter(c.encounter) ||
        Object.values(current.beds).some(p => p.clinicalEpisodeId === c.encounter.encounterId))
  );
  const reserved = new Set([
    ...principals.map(c => c.mapped.bedId),
    ...diff.admissions.map(a => a.bedId),
    ...diff.moves.map(m => m.toBedId),
  ]);
  const mothers = principals
    .filter(
      c =>
        !c.originatedAsClinicalCrib &&
        isMaternalCandidatePatient(c.mapped.patient) &&
        !diff.conflicts.some(f => f.bedId === c.mapped.bedId && f.scope !== 'clinical-crib')
    )
    .map(c => ({
      bedId: c.mapped.bedId!,
      episodeId: c.encounter.encounterId,
      name: c.mapped.patient.patientName,
      ...(current.beds[c.mapped.bedId!]?.clinicalCrib?.clinicalEpisodeId
        ? { occupiedByEpisodeId: current.beds[c.mapped.bedId!].clinicalCrib!.clinicalEpisodeId }
        : {}),
    }));
  const existingIndependent = candidates.flatMap(c => {
    const match = Object.entries(current.beds).find(
      ([, p]) =>
        p.clinicalEpisodeId === c.encounter.encounterId &&
        (p.bedMode === 'Cama' || p.bedMode === 'Cuna')
    );
    const misplacedStandaloneCrib =
      match?.[1].bedMode === 'Cuna' && c.maternalAssociationConflict === 'location-mismatch';
    if (
      misplacedStandaloneCrib &&
      !diff.conflicts.some(
        f => f.neonatalAssociationReview && f.source?.encounterId === c.encounter.encounterId
      )
    )
      diff.conflicts.push({
        bedId: match[0],
        rut: match[1].rut,
        patientName: match[1].patientName,
        scope: 'clinical-crib',
        neonatalAssociationReview: true,
        source: c.encounter,
        reason: `Eloísa: cuna C-${match[0]}. Madre: cama ${c.maternalAssociationBedId}. Confirma si el RN debe acompañar a su madre y actualiza Gestión de Camas.`,
      });
    return c.originatedAsClinicalCrib &&
      match &&
      ((!c.mapped.isClinicalCrib && match[1].bedMode === 'Cama') || misplacedStandaloneCrib) &&
      (!match[1].neonatalPlacementDecision ||
        diff.conflicts.some(
          f => f.neonatalAssociationReview && f.source?.encounterId === c.encounter.encounterId
        ))
      ? [
          {
            episodeId: c.encounter.encounterId,
            existingBedId: match[0],
            existingKind: misplacedStandaloneCrib
              ? ('standalone-crib' as const)
              : ('independent' as const),
            patient: mergeSyncablePatient(match[1], withClinicalCribDefaults(c.mapped.patient)),
            source: c.encounter,
            mothers,
            independentBeds: BEDS.map(b => b.id),
            unavailableIndependentBeds: BEDS.map(b => b.id).filter(
              id => id !== match[0] && (occupied(current.beds[id]) || reserved.has(id))
            ),
          },
        ]
      : [];
  });
  const existingNested = candidates.flatMap(c => {
    const parent = Object.entries(current.beds).find(
      ([, p]) => p.clinicalCrib?.clinicalEpisodeId === c.encounter.encounterId
    );
    if (
      !parent ||
      ((c.mapped.isClinicalCrib || c.mapped.patient.bedMode === 'Cuna') &&
        !c.maternalAssociationConflict &&
        !diff.conflicts.some(
          f => f.neonatalAssociationReview && f.source?.encounterId === c.encounter.encounterId
        ))
    )
      return [];
    const parentMove = diff.moves.find(
      m => m.fromBedId === parent[0] && m.source.encounterId === parent[1].clinicalEpisodeId
    );
    const currentMother =
      parent[1].clinicalEpisodeId && isMaternalCandidatePatient(parent[1])
        ? [
            {
              bedId: parentMove?.toBedId || parent[0],
              episodeId: parent[1].clinicalEpisodeId,
              name: parent[1].patientName,
            },
          ]
        : [];
    // A principal source assignment cannot create a second copy of an already nested RN.
    diff.admissions = diff.admissions.filter(
      a => a.source?.encounterId !== c.encounter.encounterId
    );
    return [
      {
        episodeId: c.encounter.encounterId,
        existingBedId: parent[0],
        existingKind: 'mother' as const,
        patient: mergeSyncablePatient(
          parent[1].clinicalCrib!,
          withClinicalCribDefaults(c.mapped.patient)
        ),
        source: c.encounter,
        mothers:
          c.maternalAssociationConflict ||
          diff.conflicts.some(
            f => f.neonatalAssociationReview && f.source?.encounterId === c.encounter.encounterId
          )
            ? [
                ...mothers.filter(m => m.episodeId !== parent[1].clinicalEpisodeId),
                ...currentMother,
              ]
            : [],
        independentBeds: BEDS.map(b => b.id),
        unavailableIndependentBeds: BEDS.map(b => b.id).filter(
          id =>
            occupied(current.beds[id]) ||
            diff.admissions.some(a => a.bedId === id) ||
            diff.moves.some(m => m.toBedId === id)
        ),
      },
    ];
  });
  const reviews: NeonatalPlacementReview[] = [
    ...existingIndependent,
    ...existingNested,
    ...candidates
      .filter(
        c =>
          !known.has(c.encounter.encounterId) &&
          diff.conflicts.some(
            f =>
              f.neonatalAssociationReview === true &&
              f.source?.encounterId === c.encounter.encounterId
          )
      )
      .map(c => ({
        episodeId: c.encounter.encounterId,
        patient: c.mapped.patient,
        source: c.encounter,
        mothers,
        independentBeds: BEDS.map(b => b.id),
        unavailableIndependentBeds: BEDS.map(b => b.id).filter(
          id => occupied(current.beds[id]) || reserved.has(id)
        ),
      })),
  ];
  const planned = reviews.map(review => {
    const candidate = candidates.find(c => c.encounter.encounterId === review.episodeId);
    const mothers = review.mothers.filter(
      m =>
        Boolean(m.episodeId.trim()) &&
        m.bedId === candidate?.maternalAssociationBedId &&
        (!m.occupiedByEpisodeId || m.occupiedByEpisodeId === review.episodeId)
    );
    return candidate?.maternalAssociationConflict === 'location-mismatch' &&
      candidate.mapped.isClinicalCrib &&
      review.patient.bedMode === 'Cuna' &&
      review.existingKind !== 'independent' &&
      mothers.length === 1 &&
      candidates.filter(
        c => c.originatedAsClinicalCrib && c.maternalAssociationBedId === mothers[0].bedId
      ).length === 1
      ? { ...review, automaticMother: { bedId: mothers[0].bedId, episodeId: mothers[0].episodeId } }
      : review;
  });
  const automatic = new Set(planned.filter(r => r.automaticMother).map(r => r.episodeId));
  diff.conflicts = diff.conflicts.filter(
    c => !(c.neonatalAssociationReview && c.source && automatic.has(c.source.encounterId))
  );
  diff.neonatalSourceChanges = diff.neonatalSourceChanges?.filter(c => !automatic.has(c.episodeId));
  return planned;
};

/** The proven crib rule supersedes old form choices; confirmation still validates identity/CAS. */
export const includeAutomaticMaternalChoices = (
  reviews: NeonatalPlacementReview[],
  choices: NeonatalPlacementResolution[]
): NeonatalPlacementResolution[] => [
  ...choices.filter(
    choice =>
      !reviews.some(review => review.episodeId === choice.episodeId && review.automaticMother)
  ),
  ...reviews.flatMap(review => {
    const mother = review.automaticMother;
    return mother
      ? [
          {
            episodeId: review.episodeId,
            kind: 'mother' as const,
            bedId: mother.bedId,
            parentEpisodeId: mother.episodeId,
          },
        ]
      : [];
  }),
];
