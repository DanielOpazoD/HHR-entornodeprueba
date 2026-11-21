// Public census application API. This stays as an explicit governed facade over
// a small set of feature-level controllers used across shared layers, instead
// of re-exporting the full feature surface wholesale.

export { searchMasterPatients } from './searchMasterPatientsUseCase';
export { buildUndoCmaPatch } from './cmaUndoPatchUseCase';
export type {
  ClinicalDocSummary,
  EpisodeDocuments,
  SelectedPatientDetail,
  UseGlobalPatientSearchReturn,
} from '@/features/census/components/global-search/globalSearchContracts';
export * from './atomicPatientMovementPatchController';
export * from '@/application/census/controllers/bedManagerGridItemsController';
export * from '@/application/census/controllers/bedManagerModalController';
export * from '@/application/census/controllers/censusEmailRecipientsController';
export * from '@/application/census/controllers/clinicalShiftCalendarController';
export * from '@/application/census/controllers/dischargeModalController';
export * from '@/application/census/controllers/modalFormController';
export * from '@/application/census/controllers/patientMovementCreationController';
export * from '@/application/census/controllers/patientMovementCreationErrorPresentation';
export * from '@/application/census/controllers/patientMovementMutationController';
export * from '@/application/census/controllers/patientMovementRuntimeController';
export * from '@/application/census/controllers/patientMovementSelectionController';
export * from '@/application/census/controllers/patientMovementUndoController';
export * from '@/application/census/controllers/patientMovementUndoErrorPresentation';
export * from '@/application/census/controllers/patientMovementUndoMutationController';
export * from '@/application/census/controllers/transferModalController';
