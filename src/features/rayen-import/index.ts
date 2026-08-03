/**
 * Public API of the `rayen-import` feature.
 *
 * External code must import from `@/features/rayen-import` only, never from
 * internal subpaths. Phase 1 exposes the preview/plan surface and its contracts.
 */

export type {
  RayenEncounter,
  RayenCensusSnapshot,
  RayenTreatingPhysician,
  RayenActiveBedAssignment,
} from './contracts/rayenSnapshot';

export type {
  FieldChange,
  AdmissionEntry,
  UpdateEntry,
  MoveEntry,
  DischargeEntry,
  PendingAdministrativeDischargeEntry,
  DischargeVerification,
  DischargeVerificationState,
  ConflictEntry,
  CensusImportSummary,
  CensusImportDiff,
} from './contracts/censusImportDiff';

export type {
  EgresoRecord,
  EgresoLookupResult,
  EgresoLookupTarget,
} from './contracts/egresoLookup';

export type { EgresoReportRow, ReportEgreso } from './contracts/egresoReport';
export {
  parseStatisticalEgresoInstant,
  parseStatisticalEgresoStamp,
} from './mapping/reportEgresoDateTime';

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
  evaluationScaleApplicationsAsOf,
} from './mapping/parseEvaluationScales';
export { parseHistoryScales } from './mapping/parseHistoryScales';
export type {
  RayenClinicalPanelEvent,
  RayenClinicalPanelCarePlan,
  RayenClinicalPanelResult,
} from './bridge/clinicalPanelBridge';
export { requestClinicalPanel } from './bridge/clinicalPanelBridge';
export type {
  RayenHospitalizationDocumentType,
  RayenHospitalizationEpisode,
  RayenHospitalizationReportResult,
} from './bridge/hospitalizationReportsBridge';
export {
  RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE,
  RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
  RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST_TYPE,
  RAYEN_STATISTICAL_DISCHARGE_REPORT_RESULT_TYPE,
  requestRayenHospitalizationDocument,
  requestRayenHospitalizationEpisodes,
  requestRayenStatisticalDischargeReport,
} from './bridge/hospitalizationReportsBridge';
export type { RayenEncounterNavigationResult } from './bridge/encounterNavigationBridge';
export {
  RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE,
  RAYEN_OPEN_ENCOUNTER_RESULT_TYPE,
  requestRayenEncounterNavigation,
} from './bridge/encounterNavigationBridge';
export type {
  ClinicalPanel,
  ClinicalPanelEntry,
  ClinicalPanelEntryKind,
  ClinicalPanelIndicationDay,
  EvolutionProfession,
} from './mapping/parseClinicalPanel';
export type {
  ClinicalPanelCareAction,
  ClinicalPanelCareActionStatus,
  ClinicalPanelCareDay,
} from './mapping/parseClinicalCarePlan';
export { parseClinicalPanel } from './mapping/parseClinicalPanel';
export { mergeScaleSources } from './mapping/mergeScaleSources';
export { parseVitalSigns, latestVitalsAsOf } from './mapping/parseVitalSigns';
export { mergeReportVitals } from './domain/mergeReportVitals';
export type { MergeScalesContext } from './domain/mergeReportScales';
export { mergeReportScales } from './domain/mergeReportScales';
export type { MappedDevice, RayenInvasiveDeviceEntry } from './mapping/mapDeviceToInstance';
export {
  canonicalizeRayenDeviceType,
  mapInvasiveDevices,
  mapRayenInvasiveDeviceEntries,
} from './mapping/mapDeviceToInstance';
export { extractDeviceTextItems } from './mapping/extractDeviceTextItems';
export type { PatientBedMovement, PatientFlowTimeWindow } from './mapping/parsePatientFlow';
export {
  parsePatientFlowMovements,
  latestPatientFlowMovement,
  firstPatientFlowTimestamp,
  patientRunFromFlowReport,
} from './mapping/parsePatientFlow';

export type { BedMappingResult, BedMatchKind, RayenBedLocation } from './mapping/bedMapping';
export { isCmaBedLabel, isCmaLocation, mapRayenBed } from './mapping/bedMapping';

export type { MappedPatient } from './mapping/rayenToPatientData';
export {
  rayenToPatientData,
  formatRun,
  ageFromBirthDate,
  mapBiologicalSex,
  cleanDiagnosis,
  toTitleCaseName,
  normalizeOptionalPersonName,
} from './mapping/rayenToPatientData';

export type { ReconcileOptions } from './domain/reconcileCensus';
export { reconcileCensus, requiresReview } from './domain/reconcileCensus';
export type { PrincipalBedPlacementIntent } from './domain/principalBedMovePlan';
export { feasiblePrincipalMoveSourceBedIds } from './domain/principalBedMovePlan';
export type {
  BedTraceabilityResolverDependencies,
  PatientFlowReportResult,
} from './bedTraceabilityResolver';
export {
  recoverMissingSnapshotPlacements,
  resolveOccupiedBedTraceability,
  resolveOccupiedBedTraceabilityChain,
} from './bedTraceabilityResolver';
export type { BedTraceabilityChainResult } from './bedTraceabilityResolver';

export type { ApplyContext, ApplyResult, SkippedOp } from './domain/applyCensusImportDiff';
export { applyCensusImportDiff } from './domain/applyCensusImportDiff';

export {
  applyEgresoReport,
  collectRecordedMovementRuns,
  markEgresoReportUnavailable,
} from './domain/applyEgresoReport';
export { applyEgresoLookupFallback } from './domain/applyEgresoLookupFallback';

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
  RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE,
  isRayenCensusSnapshot,
  isRayenSyncBundle,
  subscribeToRayenSnapshots,
  requestRayenSyncBundle,
  cancelRayenSyncBundleRequest,
  requestEgresoReport,
  requestEgresoLookup,
  requestDeviceReport,
  requestScalesReport,
  requestHistoryScales,
  requestCudyrCategories,
} from './bridge/rayenImportBridge';
export type { RayenSyncBundle } from './contracts/rayenSnapshot';
export {
  RAYEN_PATIENT_FLOW_REQUEST_TYPE,
  RAYEN_PATIENT_FLOW_RESULT_TYPE,
  requestPatientFlowReport,
} from './bridge/patientFlowBridge';
export type { PatientFlowBridgeResult } from './bridge/patientFlowBridge';
export type { RayenCudyrCategory, RayenHistoryScaleEvent } from './bridge/rayenImportBridge';
export type {
  RayenExtensionHealthCheck,
  RayenExtensionHealthReport,
  RayenSourceAvailability,
  RayenSourceHealth,
} from './bridge/extensionHealthBridge';
export {
  RAYEN_EXTENSION_HEALTH_REQUEST_TYPE,
  RAYEN_EXTENSION_HEALTH_RESULT_TYPE,
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  isRayenExtensionHealthReport,
  requestRayenExtensionHealth,
} from './bridge/extensionHealthBridge';

// Clinical fill runner (devices + scales + CUDYR via granular patches)
export type {
  ClinicalFillBatchApplyResult,
  ClinicalFillDeps,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
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
export { useRayenExtensionHealth } from './hooks/useRayenExtensionHealth';
export type {
  RayenExtensionConnectionState,
  RayenExtensionHealthState,
} from './hooks/useRayenExtensionHealth';

// Components
export { RayenImportButton } from './components/RayenImportButton';
export { RayenImportModeSetting } from './components/RayenImportModeSetting';
export { RayenImportPreviewModal } from './components/RayenImportPreviewModal';
export type { RayenImportPreviewModalProps } from './components/RayenImportPreviewModal';
