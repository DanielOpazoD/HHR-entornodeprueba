/**
 * Firestore Path Constants
 *
 * Centralized, typed constants for all Firestore collection and document paths.
 * Prevents typos and provides IDE autocompletion.
 */

// ============================================================================
// Hospital Configuration
// ============================================================================

import { HospitalConfigService } from '@/services/config/HospitalConfigService';

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
  AUDIT_LOGS: 'auditLogs',
} as const;

/**
 * Sub-collection names under a hospital document
 */
export const HOSPITAL_COLLECTIONS = {
  /** Daily census records */
  DAILY_RECORDS: 'dailyRecords',
  /** Clinical documents for hospitalized patients */
  CLINICAL_DOCUMENTS: 'clinicalDocuments',
  /** Clinical document templates */
  CLINICAL_DOCUMENT_TEMPLATES: 'clinicalDocumentTemplates',
  /** Settings documents (nurses, tens, etc.) */
  SETTINGS: 'settings',
  /** Export passwords for Excel files */
  EXPORT_PASSWORDS: 'exportPasswords',
  /** Global bookmarks for the hospital */
  BOOKMARKS: 'bookmarks',
  /** Trash bin for deleted records */
  DELETED_RECORDS: 'deletedRecords',
  /** Master patient index */
  PATIENTS: 'patients',
  /** Print template configurations */
  PRINT_TEMPLATES: 'printTemplates',
  /** Internal staff reminders/announcements */
  REMINDERS: 'reminders',
  /** Laboratory results parsed from Syslab */
  LAB_RESULTS: 'labResults',
  /** Wound care informed consent records */
  WOUND_CARE_CONSENTS: 'woundCareConsents',
  /** Wound care photo metadata records */
  WOUND_CARE_PHOTOS: 'woundCarePhotos',
  /** Transient wound care mobile upload QR sessions */
  WOUND_CARE_MOBILE_UPLOAD_SESSIONS: 'woundCareMobileUploadSessions',
  /** Personal reusable medical indications, grouped by user id */
  MEDICAL_INDICATION_TEMPLATES: 'medicalIndicationTemplates',
  /** Shared generated medical indication records by patient episode and day */
  MEDICAL_INDICATION_RECORDS: 'medicalIndicationRecords',
  /** Server-owned statistical specialty reclassifications for analytics reporting */
  ANALYTICS_SPECIALTY_RECLASSIFICATIONS: 'analyticsSpecialtyReclassifications',
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
  TABLE_CONFIG: 'tableConfig',
  /** Default discharge indications catalog for clinical documents */
  CLINICAL_DOCUMENT_INDICATIONS: 'clinicalDocumentIndications',
  /** Global Rayen import apply policy */
  RAYEN_IMPORT_POLICY: 'rayenImportPolicy',
} as const;

/**
 * Subcollection (under a `dailyRecords/{date}` document) holding recoverable conflict version
 * snapshots. Each doc carries an `expireAt` field governed by a Firestore TTL policy (~48h) so the
 * recoverable blobs self-expire while the audit trail persists.
 * See docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export const DAILY_RECORD_CONFLICT_SNAPSHOTS = 'conflictSnapshots';

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

/**
 * Build path to laboratory results collection
 */
export const getLabResultsPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.LAB_RESULTS}` as const;

/**
 * Build path to wound care consents collection
 */
export const getWoundCareConsentsPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.WOUND_CARE_CONSENTS}` as const;

/**
 * Build path to wound care photos collection
 */
export const getWoundCarePhotosPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.WOUND_CARE_PHOTOS}` as const;

export const getWoundCareMobileUploadSessionsPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.WOUND_CARE_MOBILE_UPLOAD_SESSIONS}` as const;

export const getMedicalIndicationTemplatesRootPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.MEDICAL_INDICATION_TEMPLATES}` as const;

export const getMedicalIndicationTemplateItemsPath = (
  userId: string,
  hospitalId: string = getActiveHospitalId()
) => `${getMedicalIndicationTemplatesRootPath(hospitalId)}/${userId}/items` as const;

export const getMedicalIndicationRecordsPath = (hospitalId: string = getActiveHospitalId()) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.MEDICAL_INDICATION_RECORDS}` as const;

export const getAnalyticsSpecialtyReclassificationsPath = (
  hospitalId: string = getActiveHospitalId()
) =>
  `${COLLECTIONS.HOSPITALS}/${hospitalId}/${HOSPITAL_COLLECTIONS.ANALYTICS_SPECIALTY_RECLASSIFICATIONS}` as const;

// ============================================================================
// Type Exports
// ============================================================================

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
export type HospitalCollectionName =
  (typeof HOSPITAL_COLLECTIONS)[keyof typeof HOSPITAL_COLLECTIONS];
export type SettingsDocName = (typeof SETTINGS_DOCS)[keyof typeof SETTINGS_DOCS];
