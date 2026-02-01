/**
 * Services Index
 * Centralized exports for all application services
 * 
 * Services are organized by domain:
 * - Auth: Authentication services
 * - Data: Data persistence (local + cloud)
 * - Export: Import/export functionality
 * - Reports: Report generation
 * - AI: Gemini AI services
 * - Utils: Utility functions
 * 
 * Usage: import { signIn, saveRecordLocal } from './services';
 */

// ============================================================
// AUTHENTICATION
// ============================================================
export {
    signIn,
    createUser,
    signOut,
    onAuthChange,
    getCurrentUser
} from './auth/authService';
export type { AuthUser } from './auth/authService';

// ============================================================
// DATA PERSISTENCE - Local Storage
// ============================================================
export {
    STORAGE_KEY,
    NURSES_STORAGE_KEY,
    getStoredRecords,
    saveRecordLocal,
    getRecordForDate,
    getAllDates,
    getPreviousDayRecord,
    getStoredNurses,
    saveStoredNurses,
    clearAllData,
    isLocalStorageAvailable,
    // Demo mode data
    getDemoRecords,
    saveDemoRecord,
    saveDemoRecords,
    getDemoRecordForDate,
    getAllDemoDates,
    clearAllDemoData,
    getPreviousDemoDayRecord
} from './storage/localStorageService';

// Local Settings (IndexedDB)
export { getAppSetting, saveAppSetting } from './settingsService';

// Legacy re-export from dataService (for backward compatibility)
export {
    getStoredRecords as getStoredData,
    STORAGE_KEY as DATA_STORAGE_KEY,
    formatDateDDMMYYYY
} from './dataService';

// ============================================================
// DATA PERSISTENCE - Firestore (Cloud)
// ============================================================
export {
    saveRecordToFirestore,
    getRecordFromFirestore,
    getAllRecordsFromFirestore,
    getMonthRecordsFromFirestore,
    subscribeToRecord,
    isFirestoreAvailable
} from './storage/firestoreService';

// ============================================================
// REPOSITORY PATTERN
// ============================================================
export {
    setFirestoreEnabled,
    isFirestoreEnabled,
    setDemoModeActive,
    isDemoModeActive,
    getForDate,
    getPreviousDay,
    save,
    subscribe,
    initializeDay,
    ensureMonthIntegrity,
    DailyRecordRepository
} from './repositories/DailyRecordRepository';
export type { IDailyRecordRepository, MonthIntegrityResult } from './repositories/DailyRecordRepository';

// ============================================================
// EXPORT / IMPORT
// ============================================================
export {
    exportDataJSON,
    exportDataCSV,
    importDataJSON,
    importDataCSV
} from './exporters/exportService';
export { generateCensusMasterExcel } from './exporters/censusMasterExport';

// ============================================================
// REPORTS
// ============================================================
export {
    generateCensusDailyRaw,
    generateCensusRangeRaw,
    generateCensusMonthRaw,
    generateCensusDailyFormatted,
    generateCensusRangeFormatted,
    generateCudyrDailyRaw
} from './exporters/reportService';

// ============================================================
// AI (GEMINI)
// ============================================================
export {
    generateShiftReport
} from './integrations/geminiService';

// ============================================================
// INTEGRATIONS
// ============================================================
export { triggerCensusEmail } from './integrations/censusEmailService';

// ============================================================
// FACTORIES
// ============================================================
export {
    createEmptyPatient,
    clonePatient
} from './factories/patientFactory';

// ============================================================
// CALCULATIONS
// ============================================================
export {
    calculateStats
} from './calculations/statsCalculator';
export type { CensusStatistics } from './calculations/statsCalculator';

// ============================================================
// UTILITIES
// ============================================================
export {
    formatDateDDMMYYYY as formatDate,
    getTodayISO,
    formatDateForDisplay
} from '@/utils/dateUtils';

export {
    generateDemoRecord,
    generateDemoForDay,
    generateDemoForWeek,
    generateDemoForMonth
} from './utils/demoDataGenerator';

// ============================================================
// ERROR HANDLING
// ============================================================
export {
    errorService,
    logError,
    logFirebaseError,
    getUserFriendlyErrorMessage,
    withRetry,
    isRetryableError
} from './utils/errorService';
export type { ErrorSeverity, ErrorLog, LogLevel as ErrorLogLevel, RetryConfig } from './utils/errorService';

export { fetchErrorLogs, purgeErrorLogs } from './errorLogService';

// ============================================================
// LOGGING
// ============================================================
export { logger, log } from './utils/loggerService';
export type { LogLevel, LogEntry } from './utils/loggerService';

// ============================================================
// FEATURE FLAGS
// ============================================================
export {
    featureFlags,
    isFeatureEnabled,
    FEATURE_FLAGS
} from './utils/featureFlags';
export type { FeatureFlag } from './utils/featureFlags';
