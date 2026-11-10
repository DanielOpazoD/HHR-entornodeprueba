import { createScopedLogger } from '@/services/utils/loggerScope';

export const catalogRepositoryLogger = createScopedLogger('CatalogRepository');
export const patientMasterRepositoryLogger = createScopedLogger('PatientMasterRepository');
export const dailyRecordInitializationLogger = createScopedLogger(
  'DailyRecordInitializationService'
);
export const dailyRecordLifecycleLogger = createScopedLogger('DailyRecordRepositoryLifecycle');
export const dailyRecordReadLogger = createScopedLogger('DailyRecordReadRepository');
export const dailyRecordSyncLogger = createScopedLogger('DailyRecordRepositorySyncService');
export const dailyRecordWriteLogger = createScopedLogger('DailyRecordWriteRepository');
export const dailyRecordWriteSupportLogger = createScopedLogger('DailyRecordWriteSupport');
export const repositoryValidationLogger = createScopedLogger('RepositoryValidation');
export const repositoryPerformanceLogger = createScopedLogger('RepositoryPerformance');
