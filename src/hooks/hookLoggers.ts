import { createScopedLogger } from '@/services/utils/loggerScope';

export const auditDataLogger = createScopedLogger('useAuditData');
export const authStateLogger = createScopedLogger('useAuthState');
export const bedOperationsLogger = createScopedLogger('useBedOperations');
export const clinicalCribLogger = createScopedLogger('useClinicalCrib');
export const dailyRecordSyncLogger = createScopedLogger('DailyRecordSync');
export const excelParserLogger = createScopedLogger('useExcelParser');
export const existingDaysLogger = createScopedLogger('useExistingDays');
export const medicalHandoffHandlersLogger = createScopedLogger('useMedicalHandoffHandlers');
export const patientAnalysisLogger = createScopedLogger('usePatientAnalysis');
export const patientAutocompleteLogger = createScopedLogger('usePatientAutocomplete');
export const storageMigrationLogger = createScopedLogger('useStorageMigration');
export const syncQueueMonitorLogger = createScopedLogger('useSyncQueueMonitor');
export const systemHealthReporterLogger = createScopedLogger('SystemHealthReporter');
export const transferManagementLogger = createScopedLogger('useTransferManagementActions');
export const globalPatientSearchLogger = createScopedLogger('useGlobalPatientSearch');
export const versionCheckLogger = createScopedLogger('VersionCheck');
