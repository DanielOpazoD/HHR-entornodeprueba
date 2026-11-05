/**
 * @module laboratory (public API)
 * @description Public entry point for the laboratory feature module.
 * Other modules should import from this file, not from internal paths.
 *
 * @example
 * ```ts
 * import { LabResultsViewerModal } from '@/features/laboratory/public';
 * ```
 */

// Main modal component
export { LabResultsViewerModal } from './components/LabResultsViewerModal';
export { LaboratoryQuickAction } from './components/LaboratoryQuickAction';

// Hook (for advanced consumers that need direct access to lab state)
export { useLabViewer } from './hooks/useLabViewer';
export type { UseLabViewerReturn } from './hooks/useLabViewer';

// Controllers (pure functions reusable by other modules)
export {
  parseRefRange,
  isOutOfRange,
  formatLabResult,
  normalizeAnalysisName,
  parseLocalizedNumber,
  parseScientificValue,
  bedSortKey,
} from './controllers/labFormattingController';

// Re-export from service layer (single source of truth)
export {
  cleanRutForSyslab,
  fetchSyslabExamDetails,
  searchSyslabExams,
} from '@/services/laboratory/syslabService';

// Syslab session and raw-value parsing, shared with the census clinical explorer.
export { useSyslabAccess } from './hooks/useSyslabAccess';
export type { SyslabAccessModel } from './hooks/useSyslabAccess';
export { parseLabMeasurement } from './controllers/labNumericParser';
export { parseDateDDMMYYYY } from './controllers/labFormattingController';

export {
  buildAnalysisData,
  isTrendVariable,
  findTrendGroup,
} from './controllers/labAnalyticsController';

export { buildLabSummaryText } from './controllers/labSummaryController';

// Firestore persistence (for cross-module access to lab results)
export { getLabResults, saveLabResults } from './services/labFirestoreService';
export type { StoredLabExam, LabResultsDocument } from './services/labFirestoreService';

// Types
export type { ProgressState, ExportConfig } from './types/labViewerTypes';
