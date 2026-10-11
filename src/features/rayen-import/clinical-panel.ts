/** Read-only patient-panel surface; does not load census reconciliation or import runners. */
export { requestClinicalPanel, requestPatientDocumentOpen } from './bridge/clinicalPanelBridge';
export type { RayenClinicalPanelResult, RayenPatientDocument } from './bridge/clinicalPanelBridge';
export { parseClinicalPanel } from './mapping/parseClinicalPanel';
export type {
  ClinicalPanel,
  ClinicalPanelEntry,
  ClinicalPanelIndicationDay,
  EvolutionProfession,
} from './mapping/parseClinicalPanel';
export type {
  ClinicalPanelCareActionStatus,
  ClinicalPanelCareDay,
} from './mapping/parseClinicalCarePlan';
export { requestClinicalAction } from './bridge/clinicalActionsBridge';
export type { ClinicalActionResult, ClinicalAntecedentEntry } from './bridge/clinicalActionsBridge';
export type {
  ClinicalAntecedentDetail,
  ClinicalAntecedentPrescription,
} from './bridge/clinicalAntecedentDetail';
export { requestRayenEncounterNavigation } from './bridge/encounterNavigationBridge';
export { requestRayenHospitalizationDocument } from './bridge/hospitalizationReportsBridge';
