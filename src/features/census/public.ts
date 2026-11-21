// Public API for code outside the census feature. Internal consumers should import local modules directly.
//
// Heavy components intentionally live behind lazy entrypoints so this barrel can
// be imported statically without pulling the component tree into the
// authenticated-shell chunk.
type LoadCensusChunk = () => Promise<unknown>;

export const preloadCensusComponentsChunk = (
  loadCensusComponents: LoadCensusChunk = () => import('./census-view')
): Promise<unknown> => loadCensusComponents();

export { CensusOperationalStateBanner } from './components/CensusOperationalStateBanner';
export { resolveCensusOperationalState } from './controllers/censusOperationalStateController';
export type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
export { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';
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
export * from '@/application/census/controllers/bedManagerGridItemsController';
export * from '@/application/census/controllers/bedManagerModalController';
export * from '@/application/census/controllers/censusEmailRecipientsController';
export * from '@/application/census/controllers/dischargeModalController';
export * from '@/application/census/controllers/patientMovementCreationController';
export * from '@/application/census/controllers/patientMovementCreationErrorPresentation';
export * from '@/application/census/controllers/patientMovementMutationController';
export * from '@/application/census/controllers/patientMovementRuntimeController';
export * from '@/application/census/controllers/patientMovementSelectionController';
export * from '@/application/census/controllers/patientMovementUndoController';
export * from '@/application/census/controllers/patientMovementUndoErrorPresentation';
export * from '@/application/census/controllers/patientMovementUndoMutationController';
export * from '@/application/census/controllers/transferModalController';
