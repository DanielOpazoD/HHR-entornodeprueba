/**
 * Hooks Index
 * Centralized exports for all custom hooks
 *
 * Usage: import { useAuthState, useDailyRecord } from './hooks';
 */

// Authentication
export { useAuthState } from './useAuthState';

// UI State Management
export { useModal } from './useModal';
export type { UseModalReturn } from './useModal';
export { useAppState } from './useAppState';
export type { UseAppStateReturn } from './useAppState';

// Daily Record Management
export { useDailyRecord } from './useDailyRecord';
export { useBedManagement } from './useBedManagement';
export { useClinicalCrib } from './useClinicalCrib';
export { useMovements } from './useMovements';

// Extracted Hooks (from useBedManagement)
export { usePatientValidation } from './usePatientValidation';
export { useBedOperations } from './useBedOperations';

// Date Navigation
export { useDateNavigation } from './useDateNavigation';
export { useExistingDaysQuery } from './useExistingDaysQuery';
export { useSignatureMode } from './useSignatureMode';
export { useSharedCensusMode } from './useSharedCensusMode';
export { useDevMetrics } from './useDevMetrics';
export { useDropdownMenu } from './useDropdownMenu';
export { useLatest } from './useLatest';
export { useLatestRef } from './useLatestRef';

// React Query Hooks
export {
  useDailyRecordQuery,
  useSaveDailyRecordMutation,
  usePrefetchDailyRecord,
  useInvalidateDailyRecord,
} from './useDailyRecordQuery';
export {
  useNursesQuery,
  useTensQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
} from './useStaffQuery';
export {
  useWhatsAppConfigQuery,
  useWhatsAppHealthQuery,
  useWhatsAppGroupsQuery,
  useUpdateWhatsAppConfigMutation,
} from './useWhatsAppQuery';
export { useBackupFilesQuery } from './useBackupFilesQuery';
export { useFileOperations } from './useFileOperations';

// Email
export { useCensusEmail } from './useCensusEmail';
export { useHandoffLogic } from './useHandoffLogic';

// Exam Request
export { useExamRequest } from './useExamRequest';

// Re-export types from hooks that define them
export type { DailyRecordContextType, DailyRecordPatch } from './useDailyRecordTypes';
export type { SyncStatus } from './useDailyRecordTypes';
export type { BedManagementActions } from './useBedManagement';
export type { ClinicalCribActions } from './useClinicalCrib';
export type { ValidationResult, PatientValidationActions } from './usePatientValidation';
export type { BedOperationsActions } from './useBedOperations';

// Internal sync hook (exposed for testing/advanced use)

// Feature Flags
export { useFeatureFlag, useAllFeatureFlags } from './useFeatureFlag';

// Version Check (auto-refresh on new deployments)
export { useVersionCheck } from './useVersionCheck';

// Audit Data Management
export { useAuditData, AUDIT_SECTIONS } from './useAuditData';
export type { AuditFiltersState, UseAuditDataReturn } from './useAuditData';
export type { AuditSection } from '@/types/audit';

// Excel Parsing
export { useExcelParser } from './useExcelParser';
export type { ParsedCell, UseExcelParserReturn } from './useExcelParser';
