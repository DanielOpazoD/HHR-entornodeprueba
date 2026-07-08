// Public census application API. This stays as an explicit governed facade over
// a small set of feature-level controllers used across shared layers, instead
// of re-exporting the full feature surface wholesale.

export { searchMasterPatients } from './searchMasterPatientsUseCase';
export { buildUndoCmaPatch } from './cmaUndoPatchUseCase';
export { useGlobalPatientSearch } from '@/features/census/components/global-search/useGlobalPatientSearch';
export type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
export { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
export type {
  ClinicalDocSummary,
  EpisodeDocuments,
  SelectedPatientDetail,
  UseGlobalPatientSearchReturn,
} from '@/features/census/components/global-search/globalSearchContracts';
export * from './atomicPatientMovementPatchController';
export * from '@/features/census/controllers/bedManagerGridItemsController';
export * from '@/features/census/controllers/bedManagerModalController';
export * from '@/features/census/controllers/censusEmailRecipientsController';
export * from '@/features/census/controllers/dischargeModalController';
export * from '@/features/census/controllers/patientMovementCreationController';
export * from '@/features/census/controllers/patientMovementCreationErrorPresentation';
export * from '@/features/census/controllers/patientMovementCreationInputController';
export * from '@/features/census/controllers/patientMovementMutationController';
export * from '@/features/census/controllers/patientMovementRuntimeController';
export * from '@/features/census/controllers/patientMovementSelectionController';
export * from '@/features/census/controllers/patientMovementUndoController';
export * from '@/features/census/controllers/patientMovementUndoErrorPresentation';
export * from '@/features/census/controllers/patientMovementUndoMutationController';
export * from '@/features/census/controllers/transferModalController';

export const loadCensusPublicComponents = () =>
  import(/* webpackPrefetch: true */ '@/features/census/census-view');
