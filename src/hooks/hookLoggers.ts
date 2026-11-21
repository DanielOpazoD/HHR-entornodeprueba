import { createScopedLogger } from '@/services/utils/loggerScope';

export const authStateLogger = createScopedLogger('useAuthState');
export const dailyRecordSyncLogger = createScopedLogger('DailyRecordSync');
export const excelParserLogger = createScopedLogger('useExcelParser');
export const patientAnalysisLogger = createScopedLogger('usePatientAnalysis');
export const storageMigrationLogger = createScopedLogger('useStorageMigration');
export const syncQueueMonitorLogger = createScopedLogger('useSyncQueueMonitor');
export const systemHealthReporterLogger = createScopedLogger('SystemHealthReporter');
export const globalPatientSearchLogger = createScopedLogger('useGlobalPatientSearch');
export const versionCheckLogger = createScopedLogger('VersionCheck');
