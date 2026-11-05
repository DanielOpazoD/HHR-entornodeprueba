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

// The Syslab reports of one hospitalization live behind `./hospitalization-reports`, the entry the
// census clinical explorer loads on demand. How Syslab is searched and read stays inside this
// feature.
export type { SyslabAccessModel } from './hooks/useSyslabAccess';

// Raw-value parsing, shared with the census clinical explorer's chart model.
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
