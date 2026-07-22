import { Specialty } from '@/types/domain/patientClassification';
import { isValidRut } from '@/utils/rutUtils';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { rayenToPatientData, type MappedPatient } from '../mapping/rayenToPatientData';

export interface MappedClinicalEncounter {
  encounter: RayenEncounter;
  mapped: MappedPatient;
}

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
  ...(hasRegisteredClinicalCribRut(patient) ? { identityStatus: 'official' as const } : {}),
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
    const currentMatch = !mapped.bedId ? findCurrent(encounter) : undefined;
    const retained = !mapped.bedId
      ? (findCurrentCrib(encounter) ??
        (currentMatch?.patient.bedMode === 'Cuna' ? currentMatch : undefined))
      : undefined;
    return {
      encounter,
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
  return promoteUnattachedClinicalCribs(
    current,
    candidates,
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
    !(mapped.isClinicalCrib && wasClinicalCribDischargedInHhr(encounter))
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
      !bedId ||
      reportedPrincipalBedIds.has(bedId) ||
      isOccupied(current.beds[bedId])
    ) {
      return candidate;
    }

    return {
      ...candidate,
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
