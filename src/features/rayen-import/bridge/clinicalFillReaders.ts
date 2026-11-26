import { markCudyrFlowArchived, recoverCudyrHospitalHistory } from './cudyrHospitalHistoryRecovery';
import { createClinicalFormsAuthorizationRecovery } from '../domain/clinicalFormsAuthorizationRecovery';
import type { ClinicalFillCandidate } from '../domain/clinicalFillCandidates';
import { requestClinicalAuthorizationSnapshot } from './clinicalAuthorizationSnapshot';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import {
  requestCudyrCategories,
  requestDeviceReport,
  requestHistoryScales,
  requestPatientClinicalBundle,
  requestScalesReport,
  requestEgresoLookup,
} from './rayenImportBridge';

/** Bind one stage's cancellation to every clinical channel, including individual recovery reads. */
export const createClinicalFillReaders = (
  signal: AbortSignal,
  candidates: readonly ClinicalFillCandidate[] = []
) => {
  const authorization = createClinicalFormsAuthorizationRecovery(candidates, signal, {
    readForms: encId => requestScalesReport(encId, undefined, signal),
    verifyEpisode: targets => requestEgresoLookup(targets, undefined, signal),
    ...(candidates.length
      ? { refreshSnapshot: () => requestClinicalAuthorizationSnapshot(signal) }
      : {}),
  });
  const expectedEncounterIds = candidates
    .map(candidate => candidate.patient.clinicalEpisodeId)
    .filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id.trim()));
  return {
    fetchDeviceReport: (encId, date) => requestDeviceReport(encId, date, undefined, signal),
    fetchHistoryScales: (encId, date, options) =>
      requestHistoryScales(encId, date, options, undefined, signal),
    fetchScalesForms: authorization.readForms,
    fetchPatientClinicalBundle: async (encId, date, options) => {
      const result = await requestPatientClinicalBundle(encId, date, options, undefined, signal);
      if (result) authorization.observe(encId, result.forms);
      return result;
    },
    recoverCudyrPlacements: (episode, rut, observedAt, identityKind, maternalRut, options) =>
      recoverCudyrHospitalHistory(
        episode,
        rut,
        signal,
        observedAt,
        identityKind,
        maternalRut,
        options
      ),
    onCudyrPlacementsArchived: markCudyrFlowArchived,
    fetchCudyrCategories: () => requestCudyrCategories(undefined, signal, expectedEncounterIds),
  } satisfies Pick<
    ClinicalFillDeps,
    | 'fetchDeviceReport'
    | 'fetchHistoryScales'
    | 'fetchScalesForms'
    | 'fetchPatientClinicalBundle'
    | 'fetchCudyrCategories'
    | 'recoverCudyrPlacements'
    | 'onCudyrPlacementsArchived'
  >;
};
