import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

export const normalizePatientRut = (rut?: string): string =>
  (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

export interface CurrentPatientRef {
  bedId: string;
  patient: PatientData;
}

export interface CensusPatientIdentityIndex {
  occupiedBedIds: ReadonlySet<string>;
  findCurrent: (encounter: RayenEncounter) => CurrentPatientRef | undefined;
  findCurrentCrib: (encounter: RayenEncounter) => CurrentPatientRef | undefined;
}

/** Indexes known episodes exactly; normalized RUN is used only for legacy occupants without one. */
export const createCensusPatientIdentityIndex = (
  current: DailyRecord,
  encounters: RayenEncounter[]
): CensusPatientIdentityIndex => {
  const principalByEpisode = new Map<string, CurrentPatientRef>();
  const legacyPrincipalsByRut = new Map<string, CurrentPatientRef[]>();
  const cribByEpisode = new Map<string, CurrentPatientRef>();
  const legacyCribsByRut = new Map<string, CurrentPatientRef[]>();
  const incomingRunCounts = new Map<string, number>();
  const occupiedBedIds = new Set<string>();

  for (const encounter of encounters) {
    const rut = normalizePatientRut(encounter.run);
    if (rut) incomingRunCounts.set(rut, (incomingRunCounts.get(rut) ?? 0) + 1);
  }

  const appendLegacy = (
    index: Map<string, CurrentPatientRef[]>,
    rut: string,
    ref: CurrentPatientRef
  ): void => {
    index.set(rut, [...(index.get(rut) ?? []), ref]);
  };

  for (const [bedId, patient] of Object.entries(current.beds)) {
    if (!isOccupied(patient)) continue;
    occupiedBedIds.add(bedId);
    const ref = { bedId, patient };
    if (patient.clinicalEpisodeId) principalByEpisode.set(patient.clinicalEpisodeId, ref);
    const rut = normalizePatientRut(patient.rut);
    // RUN is a legacy fallback only. Once HHR knows the episode, another hospitalization of the
    // same person must not inherit this bed or its pending movements.
    if (rut && !patient.clinicalEpisodeId) appendLegacy(legacyPrincipalsByRut, rut, ref);

    if (!isOccupied(patient.clinicalCrib)) continue;
    const cribRef = { bedId, patient: patient.clinicalCrib };
    if (patient.clinicalCrib.clinicalEpisodeId) {
      cribByEpisode.set(patient.clinicalCrib.clinicalEpisodeId, cribRef);
    }
    const cribRut = normalizePatientRut(patient.clinicalCrib.rut);
    if (cribRut && !patient.clinicalCrib.clinicalEpisodeId) {
      appendLegacy(legacyCribsByRut, cribRut, cribRef);
    }
  }

  const unambiguousLegacyMatch = (
    index: Map<string, CurrentPatientRef[]>,
    encounter: RayenEncounter
  ): CurrentPatientRef | undefined => {
    const rut = normalizePatientRut(encounter.run);
    if (!rut || incomingRunCounts.get(rut) !== 1) return undefined;
    const matches = index.get(rut) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  };

  return {
    occupiedBedIds,
    findCurrent: encounter =>
      principalByEpisode.get(encounter.encounterId) ??
      unambiguousLegacyMatch(legacyPrincipalsByRut, encounter),
    findCurrentCrib: encounter =>
      cribByEpisode.get(encounter.encounterId) ??
      unambiguousLegacyMatch(legacyCribsByRut, encounter),
  };
};
