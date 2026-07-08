// Public API for code outside the census feature. Internal consumers should import local modules directly.
//
// Heavy components intentionally live behind lazy entrypoints so this barrel can
// be imported statically without pulling the component tree into the
// authenticated-shell chunk.
type LoadCensusChunk = () => Promise<unknown>;

export const preloadCensusComponentsChunk = (
  loadCensusComponents: LoadCensusChunk = () => import('./census-view')
): Promise<unknown> => loadCensusComponents();

export const preloadCensusRegisterContentChunk = (
  loadCensusRegisterContent: LoadCensusChunk = () => import('./components/CensusRegisterContent')
): Promise<unknown> => loadCensusRegisterContent();

export { CensusOperationalStateBanner } from './components/CensusOperationalStateBanner';
export { resolveCensusOperationalState } from './controllers/censusOperationalStateController';
export { useGlobalPatientSearch } from './components/global-search/useGlobalPatientSearch';
export type { CensusAccessProfile } from './types/censusAccessProfile';
export { isSpecialistCensusAccessProfile } from './types/censusAccessProfile';
export type {
  ClinicalDocSummary,
  EpisodeDocuments,
  SelectedPatientDetail,
  UseGlobalPatientSearchReturn,
} from './components/global-search/globalSearchContracts';
export {
  resolveAdmissionsCountForRecord,
  resolveStaffDetailsState,
  resolveStaffIndicatorsState,
  resolveMovementSummaryState,
  resolveStaffSelectorsClassName,
  resolveStaffSelectorsState,
} from './controllers/censusStaffHeaderController';
export * from './controllers/bedManagerGridItemsController';
export * from './controllers/bedManagerModalController';
export * from './controllers/censusEmailRecipientsController';
export * from './controllers/dischargeModalController';
export * from './controllers/patientMovementCreationController';
export * from './controllers/patientMovementCreationErrorPresentation';
export * from './controllers/patientMovementCreationInputController';
export * from './controllers/patientMovementMutationController';
export * from './controllers/patientMovementRuntimeController';
export * from './controllers/patientMovementSelectionController';
export * from './controllers/patientMovementUndoController';
export * from './controllers/patientMovementUndoErrorPresentation';
export * from './controllers/patientMovementUndoMutationController';
export * from './controllers/transferModalController';
