import { recoverCudyrHospitalHistory } from './cudyrHospitalHistoryRecovery';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import {
  requestCudyrCategories,
  requestDeviceReport,
  requestHistoryScales,
  requestPatientClinicalBundle,
  requestScalesReport,
} from './rayenImportBridge';

/** Bind one stage's cancellation to every clinical channel, including legacy fallbacks. */
export const createClinicalFillReaders = (signal: AbortSignal) =>
  ({
    fetchDeviceReport: (encId, date) => requestDeviceReport(encId, date, undefined, signal),
    fetchHistoryScales: (encId, date, options) =>
      requestHistoryScales(encId, date, options, undefined, signal),
    fetchScalesForms: encId => requestScalesReport(encId, undefined, signal),
    fetchPatientClinicalBundle: (encId, date, options) =>
      requestPatientClinicalBundle(encId, date, options, undefined, signal),
    recoverCudyrPlacements: (episode, rut, observedAt, identityKind, maternalRut) =>
      recoverCudyrHospitalHistory(episode, rut, signal, observedAt, identityKind, maternalRut),
    fetchCudyrCategories: () => requestCudyrCategories(undefined, signal),
  }) satisfies Pick<
    ClinicalFillDeps,
    | 'fetchDeviceReport'
    | 'fetchHistoryScales'
    | 'fetchScalesForms'
    | 'fetchPatientClinicalBundle'
    | 'fetchCudyrCategories'
    | 'recoverCudyrPlacements'
  >;
