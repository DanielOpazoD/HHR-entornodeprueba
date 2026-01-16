/**
 * Firestore Path Constants
 * 
 * Centralized, typed constants for all Firestore collection and document paths.
 * Prevents typos and provides IDE autocompletion.
 */

// ============================================================================
// Hospital Configuration
// ============================================================================

import { HospitalConfigService } from '../services/config/HospitalConfigService';

/**
 * Hospital ID - used as the root document for all hospital data.
 * Now dynamic via HospitalConfigService for multi-tenancy.
 */
export const getActiveHospitalId = () => HospitalConfigService.getHospitalId();

// Legacy constant for broad compatibility during transition
/** @deprecated Use getActiveHospitalId() */
export const HOSPITAL_ID = HospitalConfigService.getHospitalId();

// ============================================================================
// Collection Names
// ============================================================================

/**
 * Top-level collection names
 */
export const COLLECTIONS = {
    /** Hospital documents collection */
    HOSPITALS: 'hospitals',
    /** Audit logs collection (top-level) */
    AUDIT_LOGS: 'auditLogs'
} as const;

/**
 * Sub-collection names under a hospital document
 */
export const HOSPITAL_COLLECTIONS = {
    /** Daily census records */
    DAILY_RECORDS: 'dailyRecords',
    /** Settings documents (nurses, tens, etc.) */
    SETTINGS: 'settings',
    /** Export passwords for Excel files */
    EXPORT_PASSWORDS: 'exportPasswords',
    /** Global bookmarks for the hospital */
    BOOKMARKS: 'bookmarks',
    /** Trash bin for deleted records */
    DELETED_RECORDS: 'deletedRecords'
} as const;

// ============================================================================
// Settings Document IDs
// ============================================================================

/**
 * Document IDs within the 'settings' collection
 */
export const SETTINGS_DOCS = {
    /** Nurse catalog */
    NURSES: 'nurses',
    /** TENS catalog */
    TENS: 'tens',
    /** Table column configuration */
    TABLE_CONFIG: 'tableConfig'
} as const;

// ============================================================================
// Path Builders
// ============================================================================

/**
 * Build full path to a hospital's collection
 */
export const getHospitalPath = (hospitalId: string = getActiveHospitalId()) =>
    `${COLLECTIONS.HOSPITALS}/${hospitalId}` as const;

/**
 * Build path to daily records collection
 */
export const getDailyRecordsPath = (hospitalId: string = getActiveHospitalId()) =>
    `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.DAILY_RECORDS}` as const;

/**
 * Build path to settings collection
 */
export const getSettingsPath = (hospitalId: string = getActiveHospitalId()) =>
    `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.SETTINGS}` as const;

/**
 * Build path to a specific settings document
 */
export const getSettingsDocPath = (
    docId: keyof typeof SETTINGS_DOCS | string,
    hospitalId: string = getActiveHospitalId()
) => `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.SETTINGS}/${docId}` as const;

/**
 * Build path to export passwords collection
 */
export const getExportPasswordsPath = (hospitalId: string = getActiveHospitalId()) =>
    `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.EXPORT_PASSWORDS}` as const;

// ============================================================================
// Type Exports
// ============================================================================

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];
export type HospitalCollectionName = typeof HOSPITAL_COLLECTIONS[keyof typeof HOSPITAL_COLLECTIONS];
export type SettingsDocName = typeof SETTINGS_DOCS[keyof typeof SETTINGS_DOCS];
