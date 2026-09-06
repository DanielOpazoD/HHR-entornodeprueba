import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  NursingStaffingProposal,
  RayenNursingActivity,
} from '../contracts/nursingShiftInference';
import { collectClinicalFillCandidates } from './clinicalFillCandidates';
import { createConcurrencyGate } from './concurrencyGate';
import { inferNursingShifts, type NursingActivityObservation } from './inferNursingShifts';
import { isOccupiedCensusPatient } from './censusReconciliationPredicates';

interface NursingHistoryResult {
  nursingActivity: RayenNursingActivity[];
  error?: string;
}

export interface CollectNursingStaffingProposalDeps {
  fetchHistory: (encounterId: string, censusDate: string) => Promise<NursingHistoryResult>;
  nurseCatalog?: string[];
  registerStaff?: <T extends RayenNursingActivity>(observations: T[]) => Promise<T[]>;
  tensCatalog?: string[];
  concurrency?: number;
}

/**
 * Reads only the signed clinical history needed to infer staffing. It intentionally does not
 * persist census or clinical data, so Dotacion can be refreshed and reviewed independently.
 */
export const collectNursingStaffingProposal = async (
  record: DailyRecord,
  deps: CollectNursingStaffingProposalDeps
): Promise<NursingStaffingProposal> => {
  const hasUnavailableSource = Object.values(record.beds).some(patient =>
    [patient, patient?.clinicalCrib].some(
      candidate => isOccupiedCensusPatient(candidate) && !candidate.clinicalEpisodeId
    )
  );
  if (hasUnavailableSource) {
    throw new Error(
      'No se pudo identificar el episodio clínico de todos los pacientes para revisar la dotación.'
    );
  }
  const candidates = collectClinicalFillCandidates(record);
  const withReadSlot = createConcurrencyGate(Math.max(1, deps.concurrency ?? 4));
  const observations: NursingActivityObservation[] = [];
  let failedSources = 0;
  let attemptedSources = 0;

  await Promise.all(
    candidates.map(({ patient }) => {
      const encounterId = patient.clinicalEpisodeId;
      if (!encounterId) return Promise.resolve();
      attemptedSources += 1;
      return withReadSlot(async () => {
        const result = await deps.fetchHistory(encounterId, record.date);
        if (result.error) failedSources += 1;
        for (const activity of result.nursingActivity ?? []) {
          observations.push({ ...activity, encounterId });
        }
      }).catch(() => {
        failedSources += 1;
      });
    })
  );

  if (candidates.length > 0 && attemptedSources === 0) {
    throw new Error(
      'No hay episodios clínicos identificados para consultar la actividad firmada de Enfermería/TENS.'
    );
  }
  if (failedSources > 0) {
    throw new Error(
      'No se pudo leer toda la actividad firmada de Enfermería/TENS en Eloísa. Reintenta la revisión de dotación.'
    );
  }

  return inferNursingShifts(
    deps.registerStaff ? await deps.registerStaff(observations) : observations,
    record.date,
    deps.nurseCatalog ?? [],
    deps.tensCatalog ?? []
  );
};
