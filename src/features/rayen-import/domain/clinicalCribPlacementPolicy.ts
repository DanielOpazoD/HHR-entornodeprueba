import {
  neonatalMaternalLookupRut,
  neonatalSourceRunIsMaternal,
} from './neonatalMaternalLookupIdentity';
import { isDischargedEncounter } from './censusReconciliationPredicates';
import { Specialty } from '@/types/domain/patientClassification';
import { isValidRut } from '@/utils/rutUtils';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { rayenToPatientData } from '../mapping/rayenToPatientData';
import {
  associateClinicalCribsWithMothers,
  isNeonatalPatient,
  isMaternalCandidatePatient,
  type MappedClinicalEncounter,
} from './clinicalCribMaternalAssociation';

export type { MappedClinicalEncounter } from './clinicalCribMaternalAssociation';

interface CurrentPatientRef {
  bedId: string;
  patient: PatientData;
}

type FindCurrentPatient = (encounter: RayenEncounter) => CurrentPatientRef | undefined;

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

export const hasRegisteredClinicalCribRut = (patient: PatientData): boolean =>
  isValidRut(patient.rut ?? '');

export const withClinicalCribDefaults = (patient: PatientData): PatientData => ({
  ...patient,
  specialty: Specialty.PEDIATRIA,
  identityStatus: hasRegisteredClinicalCribRut(patient) ? 'official' : 'provisional',
});

export const reportedPrincipalBedIdsFrom = (
  encounters: RayenEncounter[],
  reference: Date
): ReadonlySet<string> =>
  new Set(
    encounters
      .map(encounter => rayenToPatientData(encounter, reference))
      .filter(mapped => !mapped.isClinicalCrib && mapped.bedId)
      .map(mapped => mapped.bedId as string)
  );

export const prepareActiveClinicalPlacements = (
  current: DailyRecord,
  encounters: RayenEncounter[],
  allEncounters: RayenEncounter[],
  reference: Date,
  findCurrent: FindCurrentPatient,
  findCurrentCrib: FindCurrentPatient
): MappedClinicalEncounter[] => {
  const candidates = encounters.map(encounter => {
    const mapped = rayenToPatientData(encounter, reference);
    const matches = [findCurrent(encounter), findCurrentCrib(encounter)];
    const reviewed =
      matches.find(p => p?.patient.clinicalEpisodeId === encounter.encounterId) ??
      matches.find(Boolean);
    const decision = reviewed?.patient.neonatalPlacementDecision;
    const key = (run: string) => run.replace(/[^0-9kK]/g, '').toUpperCase();
    const maternalRut =
      neonatalMaternalLookupRut(current, allEncounters, encounter.encounterId, encounter.run) ||
      decision?.maternalRut ||
      reviewed?.patient.neonatalMaternalRut;
    const provenMaternalRun = Boolean(
      (maternalRut && key(maternalRut) === key(encounter.run)) ||
      (decision?.sourceRunIsMaternal === true &&
        key(decision.sourceRun ?? '') === key(encounter.run))
    );
    const parentalRun =
      provenMaternalRun ||
      neonatalSourceRunIsMaternal(current, allEncounters, encounter.encounterId, encounter.run);
    if (
      (isNeonatalPatient(mapped.patient) || (reviewed && isNeonatalPatient(reviewed.patient))) &&
      (!encounter.run || parentalRun)
    ) {
      const sameEpisode = reviewed?.patient.clinicalEpisodeId === encounter.encounterId;
      const ownRun =
        sameEpisode &&
        reviewed.patient.rut &&
        (key(reviewed.patient.rut) !== key(encounter.run) || !provenMaternalRun)
          ? reviewed.patient.rut
          : '';
      mapped.patient = {
        ...mapped.patient,
        ...(sameEpisode
          ? {
              patientName: reviewed.patient.patientName,
              firstName: reviewed.patient.firstName,
              lastName: reviewed.patient.lastName,
              secondLastName: reviewed.patient.secondLastName,
              documentType: reviewed.patient.documentType,
            }
          : {}),
        ...(maternalRut ? { neonatalMaternalRut: maternalRut } : {}),
        rut: ownRun,
        identityStatus: ownRun ? reviewed!.patient.identityStatus : 'provisional',
      };
    }
    if (
      (isNeonatalPatient(mapped.patient) || (reviewed && isNeonatalPatient(reviewed.patient))) &&
      isValidRut(mapped.patient.rut)
    )
      mapped.patient.identityStatus = 'official';
    if (
      mapped.isClinicalCrib &&
      reviewed?.patient.bedMode === 'Cama' &&
      reviewed.patient.clinicalEpisodeId === encounter.encounterId &&
      (!decision ||
        (decision.kind === 'independent' &&
          decision.clinicalEpisodeId === encounter.encounterId &&
          decision.bedId === reviewed.bedId))
    ) {
      return {
        encounter,
        originatedAsClinicalCrib: true,
        mapped: {
          ...mapped,
          bedId: reviewed.bedId,
          isClinicalCrib: false,
          patient: {
            ...mapped.patient,
            bedId: reviewed.bedId,
            bedMode: 'Cama' as const,
          },
        },
      };
    }
    const currentMatch = !mapped.bedId ? findCurrent(encounter) : undefined;
    const retained = !mapped.bedId
      ? (findCurrentCrib(encounter) ??
        (currentMatch?.patient.bedMode === 'Cuna' ? currentMatch : undefined))
      : undefined;
    return {
      encounter,
      originatedAsClinicalCrib: mapped.isClinicalCrib || Boolean(decision),
      mapped: retained
        ? {
            ...mapped,
            bedId: retained.bedId,
            isClinicalCrib: true,
            patient: { ...mapped.patient, bedId: retained.bedId, bedMode: 'Cuna' as const },
          }
        : mapped,
    };
  });
  // A clinically closed mother is retained until the administrative discharge.
  // Her exact source episode can still identify the mother of an active RN.
  const retainedMothers = allEncounters
    .filter(e => !encounters.some(active => active.encounterId === e.encounterId))
    .flatMap(encounter => {
      const mapped = rayenToPatientData(encounter, reference);
      if (mapped.isClinicalCrib) return [];
      const known = findCurrent(encounter);
      if (
        (isDischargedEncounter(encounter) &&
          known?.patient.clinicalEpisodeId !== encounter.encounterId) ||
        known?.patient.neonatalPlacementDecision
      )
        return [];
      const bedId =
        isDischargedEncounter(encounter) && !encounter.verifiedBedPlacement && known
          ? known.bedId
          : mapped.bedId;
      return bedId ? [{ encounter, mapped: { ...mapped, bedId } }] : [];
    });
  return promoteUnattachedClinicalCribs(
    current,
    associateClinicalCribsWithMothers(
      candidates,
      candidate => findCurrent(candidate.encounter)?.patient.patientName,
      candidate => {
        const known = findCurrentCrib(candidate.encounter);
        const parent = known && current.beds[known.bedId];
        const decision = known?.patient.neonatalPlacementDecision;
        const maternalRut =
          decision?.clinicalEpisodeId === candidate.encounter.encounterId
            ? decision.maternalRut || known?.patient.neonatalMaternalRut
            : known?.patient.neonatalMaternalRut;
        const rutKey = (value: string) => value.replace(/[^0-9kK]/g, '').toUpperCase();
        if (
          known?.patient.clinicalEpisodeId === candidate.encounter.encounterId &&
          parent &&
          (!isMaternalCandidatePatient(parent) ||
            (maternalRut && rutKey(maternalRut) !== rutKey(parent.rut ?? '')))
        )
          return {
            episodeId: parent.clinicalEpisodeId ?? '',
            bedId: known.bedId,
            rut: parent.rut,
            parentConflict: true,
          };

        if (
          known?.patient.clinicalEpisodeId === candidate.encounter.encounterId &&
          decision?.kind === 'mother' &&
          decision.clinicalEpisodeId === candidate.encounter.encounterId &&
          decision.parentEpisodeId &&
          decision.parentEpisodeId !== parent?.clinicalEpisodeId
        )
          return {
            episodeId: decision.parentEpisodeId,
            bedId: known.bedId,
            rut: decision.maternalRut ?? '',
            reviewed: true,
            sourceRun: decision.sourceRun,
            parentConflict: true,
          };
        return known?.patient.clinicalEpisodeId === candidate.encounter.encounterId &&
          parent?.clinicalEpisodeId
          ? {
              episodeId: parent.clinicalEpisodeId,
              bedId: known.bedId,
              rut: parent.rut,
              sourceRun: known.patient.neonatalPlacementDecision?.sourceRun,
              sourcePlacementKey: known.patient.neonatalPlacementDecision?.sourcePlacementKey,
              sourceRunIsMaternal: known.patient.neonatalPlacementDecision?.sourceRunIsMaternal,
              reviewed:
                known.patient.neonatalPlacementDecision?.kind === 'mother' &&
                known.patient.neonatalPlacementDecision.clinicalEpisodeId ===
                  candidate.encounter.encounterId &&
                known.patient.neonatalPlacementDecision.parentEpisodeId ===
                  parent.clinicalEpisodeId,
            }
          : undefined;
      },
      [...candidates, ...retainedMothers].filter(
        c =>
          (!isDischargedEncounter(c.encounter) ||
            findCurrent(c.encounter)?.patient.clinicalEpisodeId === c.encounter.encounterId) &&
          !current.beds[c.mapped.bedId ?? '']?.isBlocked
      )
    ),
    reportedPrincipalBedIdsFrom(allEncounters, reference)
  );
};

export const shouldReconcileAsPrincipal = (
  candidate: MappedClinicalEncounter,
  findCurrent: FindCurrentPatient,
  wasClinicalCribDischargedInHhr: (encounter: RayenEncounter) => boolean
): boolean => {
  const { encounter, mapped } = candidate;
  const isPromoted =
    !!mapped.isClinicalCrib && !!mapped.bedId && findCurrent(encounter)?.patient.bedMode === 'Cuna';
  return (
    (!mapped.isClinicalCrib || isPromoted) &&
    !(
      (candidate.originatedAsClinicalCrib ?? mapped.isClinicalCrib) &&
      wasClinicalCribDischargedInHhr(encounter)
    )
  );
};

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

export const pendingClinicalCribDischargeIdentities = (
  candidates: MappedClinicalEncounter[]
): ReadonlySet<string> =>
  new Set(
    candidates.map(({ encounter, mapped }) =>
      encounter.encounterId
        ? `episode:${encounter.encounterId}`
        : `run:${normalizeRut(mapped.patient.rut)}`
    )
  );

/**
 * A Rayen "Cuna" is virtual only while its equivalent physical bed has a principal patient.
 * When no principal encounter is reported and the HHR bed is free, the newborn occupies that
 * physical bed as a principal patient and therefore counts towards the service's 18 beds.
 */
export const promoteUnattachedClinicalCribs = (
  current: DailyRecord,
  candidates: MappedClinicalEncounter[],
  reportedPrincipalBedIds: ReadonlySet<string>
): MappedClinicalEncounter[] =>
  candidates.map(candidate => {
    const { mapped } = candidate;
    const bedId = mapped.bedId;
    if (
      !mapped.isClinicalCrib ||
      candidate.maternalAssociationConflict === 'ambiguous' ||
      candidate.maternalAssociationConflict === 'location-mismatch' ||
      !bedId ||
      reportedPrincipalBedIds.has(bedId) ||
      isOccupied(current.beds[bedId])
    ) {
      return candidate;
    }

    return {
      ...candidate,
      maternalAssociationConflict: undefined,
      mapped: {
        ...mapped,
        isClinicalCrib: false,
        patient: withClinicalCribDefaults({
          ...mapped.patient,
          bedId,
          // The newborn is the principal occupant of the physical slot, configured as a crib.
          bedMode: 'Cuna',
        }),
      },
    };
  });
