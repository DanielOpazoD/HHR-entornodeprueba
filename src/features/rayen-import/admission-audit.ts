/** Read-only sources and hospital clock for admission auditing; no reconciliation/import runtime. */
// HHR restricts the audit panel/cohort to admin. Clinical reads retain Eloísa session authorization,
// as do the existing full hospitalization reports; this entrypoint grants no new source permission.
export { requestClinicalPanel } from './bridge/clinicalPanelBridge';
export type { RayenClinicalPanelEvent } from './bridge/clinicalPanelBridge';
export { parseClinicalPanel } from './mapping/parseClinicalPanel';
export type { ClinicalPanelEntry } from './mapping/parseClinicalPanel';
export { parseAdmissionVitalSigns } from './mapping/parseAdmissionVitalSigns';
export { encounterWallClockInRapaNui } from './mapping/encounterWallClock';
export { compareStamps } from './mapping/clinicalPanelParsingUtils';
