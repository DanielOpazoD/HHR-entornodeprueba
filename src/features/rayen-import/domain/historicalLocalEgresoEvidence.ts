import { normalizeRut } from '@/utils/rutUtils';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';

export interface LocalHistoricalOccupant {
  encounter: RayenEncounter;
  bedId: string;
  isClinicalCrib: boolean;
}

export interface VerifiedLocalEgresoOccupant extends LocalHistoricalOccupant {
  exactEgresoVerified: true;
  dischargeAt: string;
}

export interface ExactLocalEgresoResolution {
  verified: VerifiedLocalEgresoOccupant[];
  unresolved: LocalHistoricalOccupant[];
}

const encounterFromLocal = (
  patient: PatientData,
  clinicalCribParentBedId?: string
): RayenEncounter => ({
  encounterId: patient.clinicalEpisodeId?.trim() ?? '',
  run: patient.rut,
  firstGivenName: patient.firstName?.trim() || patient.patientName,
  firstFamilyName: patient.lastName?.trim() || '',
  secondFamilyName: patient.secondLastName,
  admissionDatetime: patient.admissionDate
    ? `${patient.admissionDate}T${patient.admissionTime || '00:00'}:00`
    : undefined,
  diagnosis: patient.pathology,
  service: patient.location,
  clinicalCribParentBedId,
});

/** Local occupants absent from today's live sources, retaining the only bed HHR may preserve. */
export const collectUnreferencedLocalOccupants = (
  record: DailyRecord,
  referencedEpisodes: ReadonlySet<string>
): LocalHistoricalOccupant[] => {
  const occupants: LocalHistoricalOccupant[] = [];
  for (const [bedId, bed] of Object.entries(record.beds)) {
    for (const entry of [
      { patient: bed, isClinicalCrib: false },
      { patient: bed.clinicalCrib, isClinicalCrib: true },
    ]) {
      const patient = entry.patient;
      if (!patient?.patientName?.trim() || patient.isBlocked) continue;
      const encounter = encounterFromLocal(patient, entry.isClinicalCrib ? bedId : undefined);
      if (encounter.encounterId && referencedEpisodes.has(encounter.encounterId)) continue;
      occupants.push({ encounter, bedId, isClinicalCrib: entry.isClinicalCrib });
    }
  }
  return occupants;
};

const exactVerifiedDischargeAt = (
  occupant: LocalHistoricalOccupant,
  result: EgresoLookupResult | undefined
): string | null => {
  const egreso = result?.egreso;
  if (
    !egreso ||
    result?.encounterId !== occupant.encounter.encounterId ||
    normalizeRut(result?.run) !== normalizeRut(occupant.encounter.run) ||
    egreso.hasAdministrativeDischarge === false
  )
    return null;
  return encounterWallClockInRapaNui(String(egreso.dateDischarge || egreso.endPeriod || ''));
};

/**
 * Verifies missing local episodes against Gestión de Camas by exact ENC_ID + RUN.
 * Merely finding another hospitalization for the same RUN never authorizes reconstruction.
 */
export const verifyLocalOccupantsByExactEgreso = async (
  occupants: LocalHistoricalOccupant[],
  lookup?: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>
): Promise<ExactLocalEgresoResolution> => {
  if (!lookup) return { verified: [], unresolved: occupants };
  const eligible = occupants.filter(
    item =>
      !item.isClinicalCrib &&
      /^\d+$/.test(item.encounter.encounterId) &&
      Boolean(normalizeRut(item.encounter.run))
  );
  if (eligible.length === 0) return { verified: [], unresolved: occupants };

  let results: EgresoLookupResult[] = [];
  try {
    results = await lookup(
      eligible.map(item => ({
        run: item.encounter.run,
        encounterId: item.encounter.encounterId,
      }))
    );
  } catch {
    return { verified: [], unresolved: occupants };
  }

  const verified: VerifiedLocalEgresoOccupant[] = [];
  const verifiedEpisodes = new Set<string>();
  for (const occupant of eligible) {
    const result = results.find(
      candidate => candidate.encounterId === occupant.encounter.encounterId
    );
    const dischargeAt = exactVerifiedDischargeAt(occupant, result);
    if (!dischargeAt) continue;
    verified.push({ ...occupant, exactEgresoVerified: true, dischargeAt });
    verifiedEpisodes.add(occupant.encounter.encounterId);
  }
  return {
    verified,
    unresolved: occupants.filter(occupant => !verifiedEpisodes.has(occupant.encounter.encounterId)),
  };
};
