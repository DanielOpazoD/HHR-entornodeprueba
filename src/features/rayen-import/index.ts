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
  PendingNursingDischargeEntry,
  ConflictEntry,
  CensusImportSummary,
  CensusImportDiff,
} from './contracts/censusImportDiff';

export type { EgresoRecord, EgresoLookupResult } from './contracts/egresoLookup';

export type { EgresoReportRow, ReportEgreso } from './contracts/egresoReport';

export type { DischargeKind, DischargeIntent } from './mapping/dischargeMapping';
export { resolveDischargeIntent } from './mapping/dischargeMapping';

export type { EgresoDischarge } from './mapping/egresoDischargeMapping';
export { mapEgresoToDischarge } from './mapping/egresoDischargeMapping';

export type { DestinoDischarge } from './mapping/mapDestinoDeAlta';
export { mapDestinoDeAlta } from './mapping/mapDestinoDeAlta';

export type { DeviceTextItem, InvasiveDeviceRow } from './mapping/parseInvasiveDevices';
export { parseInvasiveDevices } from './mapping/parseInvasiveDevices';
export type {
  EvaluationScaleCode,
  EvaluationScaleItem,
  EvaluationScale,
} from './mapping/parseEvaluationScales';
export {
  parseEvaluationScales,
  latestEvaluationScales,
  evaluationScalesForCensusDay,
  evaluationScalesAsOf,
} from './mapping/parseEvaluationScales';
export { parseHistoryScales } from './mapping/parseHistoryScales';
export { mergeScaleSources } from './mapping/mergeScaleSources';
export { parseVitalSigns, latestVitalsAsOf } from './mapping/parseVitalSigns';
export type { MergeVitalsContext } from './domain/mergeReportVitals';
export { mergeReportVitals } from './domain/mergeReportVitals';
export type { MergeScalesContext } from './domain/mergeReportScales';
export { mergeReportScales } from './domain/mergeReportScales';
export type { MappedDevice } from './mapping/mapDeviceToInstance';
export { mapInvasiveDevices } from './mapping/mapDeviceToInstance';
export { extractDeviceTextItems } from './mapping/extractDeviceTextItems';

export type { BedMappingResult, BedMatchKind, RayenBedLocation } from './mapping/bedMapping';
export { mapRayenBed } from './mapping/bedMapping';

export type { MappedPatient } from './mapping/rayenToPatientData';
export {
  rayenToPatientData,
  formatRun,
  ageFromBirthDate,
  mapBiologicalSex,
  cleanDiagnosis,
  toTitleCaseName,
} from './mapping/rayenToPatientData';

export type { ReconcileOptions } from './domain/reconcileCensus';
export { reconcileCensus, requiresReview } from './domain/reconcileCensus';

export type { ApplyContext, ApplyResult, SkippedOp } from './domain/applyCensusImportDiff';
export { applyCensusImportDiff } from './domain/applyCensusImportDiff';

export { applyEgresoLookups, runsNeedingEgresoLookup } from './domain/applyEgresoLookups';

export { applyEgresoReport, collectKnownRuns } from './domain/applyEgresoReport';

export type { MergeDevicesContext } from './domain/mergeReportDevices';
export { mergeReportDevices } from './domain/mergeReportDevices';

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
  requestEgresoLookup,
  requestEgresoReport,
  requestDeviceReport,
  requestScalesReport,
  requestHistoryScales,
  requestCudyrCategories,
} from './bridge/rayenImportBridge';
export type { RayenCudyrCategory, RayenHistoryScaleEvent } from './bridge/rayenImportBridge';

// Clinical fill runner (devices + scales + CUDYR via granular patches)
export type {
  ClinicalFillDeps,
  ClinicalFillError,
  ClinicalFillProgress,
  ClinicalFillSummary,
} from './clinicalFillRunner';
export { runClinicalFill } from './clinicalFillRunner';

// Hooks
export { useRayenFillStatus, useRayenFillProgress } from './hooks/useRayenFillStatus';
export type { RayenFillProgress } from './hooks/useRayenFillStatus';
export { useRayenImportMode } from './hooks/useRayenImportMode';
export type { UseRayenImportModeResult } from './hooks/useRayenImportMode';
export { useRayenImport } from './hooks/useRayenImport';

// Components
export { RayenImportButton } from './components/RayenImportButton';
export { RayenImportModeSetting } from './components/RayenImportModeSetting';
export { RayenImportPreviewModal } from './components/RayenImportPreviewModal';
export type { RayenImportPreviewModalProps } from './components/RayenImportPreviewModal';
