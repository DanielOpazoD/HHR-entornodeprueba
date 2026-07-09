/**
 * Public API of the `rayen-import` feature.
 *
 * External code must import from `@/features/rayen-import` only, never from
 * internal subpaths. Phase 1 exposes the preview/plan surface and its contracts.
 */

export type { RayenEncounter, RayenCensusSnapshot } from './contracts/rayenSnapshot';

export type {
  FieldChange,
  AdmissionEntry,
  UpdateEntry,
  MoveEntry,
  DischargeEntry,
  ConflictEntry,
  CensusImportSummary,
  CensusImportDiff,
} from './contracts/censusImportDiff';

export type { DischargeKind, DischargeIntent } from './mapping/dischargeMapping';
export { resolveDischargeIntent } from './mapping/dischargeMapping';

export type { BedMappingResult, BedMatchKind, RayenBedLocation } from './mapping/bedMapping';
export { mapRayenBed } from './mapping/bedMapping';

export type { MappedPatient } from './mapping/rayenToPatientData';
export {
  rayenToPatientData,
  formatRun,
  ageFromBirthDate,
  mapBiologicalSex,
  cleanDiagnosis,
} from './mapping/rayenToPatientData';

export type { ReconcileOptions } from './domain/reconcileCensus';
export { reconcileCensus, requiresReview } from './domain/reconcileCensus';

export type { ApplyContext, ApplyResult, SkippedOp } from './domain/applyCensusImportDiff';
export { applyCensusImportDiff } from './domain/applyCensusImportDiff';

export type {
  PlanRayenCensusImportInput,
  PlanRayenCensusImportResult,
} from './importRayenCensusUseCase';
export { planRayenCensusImport } from './importRayenCensusUseCase';

// Settings (import mode)
export type { RayenImportMode } from './settings/rayenImportSettings';
export {
  DEFAULT_RAYEN_IMPORT_MODE,
  getRayenImportMode,
  setRayenImportMode,
  subscribeRayenImportMode,
} from './settings/rayenImportSettings';

// Bridge (extension ⇄ app)
export {
  RAYEN_IMPORT_MESSAGE_TYPE,
  RAYEN_REQUEST_MESSAGE_TYPE,
  isRayenCensusSnapshot,
  subscribeToRayenSnapshots,
  pushRayenSnapshot,
  requestRayenSnapshot,
} from './bridge/rayenImportBridge';

// Hooks
export { useRayenImportMode } from './hooks/useRayenImportMode';
export type { UseRayenImportModeResult } from './hooks/useRayenImportMode';
export { useRayenImport } from './hooks/useRayenImport';

// Components
export { RayenImportButton } from './components/RayenImportButton';
export { RayenImportModeSetting } from './components/RayenImportModeSetting';
export { RayenImportPreviewModal } from './components/RayenImportPreviewModal';
export type { RayenImportPreviewModalProps } from './components/RayenImportPreviewModal';
