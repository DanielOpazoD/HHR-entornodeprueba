/**
 * Constants Index
 * Centralized exports for all application constants
 * 
 * Usage: import { BEDS, DEVICE_OPTIONS, MONTH_NAMES } from './constants';
 */

// Bed Configuration
export {
    HOSPITAL_CAPACITY,
    BEDS,
    EXTRA_BEDS,
    REGULAR_BEDS,
    UTI_BEDS,
    MEDIA_BEDS
} from './beds';

// Clinical Options
export {
    SPECIALTY_OPTIONS,
    STATUS_OPTIONS,
    SPECIALTY_ABBREVIATIONS,
    ADMISSION_ORIGIN_OPTIONS,
    DEVICE_OPTIONS,
    VVP_DEVICE_KEYS,
    EVACUATION_METHODS,
    RECEIVING_CENTERS,
    DEFAULT_EVACUATION_METHOD,
    EVACUATION_METHOD_AEROCARDAL,
    EVACUATION_METHOD_COMMERCIAL,
    EVACUATION_METHOD_OTHER,
    DEFAULT_RECEIVING_CENTER,
    RECEIVING_CENTER_OTHER,
    RECEIVING_CENTER_EXTRASYSTEM,
    DISCHARGE_STATUSES,
    DEFAULT_DISCHARGE_STATUS,
    DISCHARGE_TYPES,
    DEFAULT_DISCHARGE_TYPE,
    DISCHARGE_TYPE_OTHER,
    TRANSFER_ESCORT_OPTIONS,
    DEFAULT_TRANSFER_ESCORT,
    isTransferEscortOption,
    isEvacuationMethod,
    isReceivingCenter,
    normalizeEvacuationMethod,
    normalizeReceivingCenter
} from './clinical';
export type {
    AdmissionOrigin,
    DeviceType,
    EvacuationMethod,
    ReceivingCenter,
    DischargeStatus,
    DischargeType,
    TransferEscortOption
} from './clinical';

// Patient Defaults
export { EMPTY_PATIENT } from './patient';

// Export/CSV
export {
    CSV_HEADERS,
    MONTH_NAMES
} from './export';
export type { MonthName } from './export';

// Demo Data
export {
    DEMO_NAMES,
    DEMO_DIAGNOSES,
    DEMO_RUTS
} from './demo';

// Exam Request Form
export {
    EXAM_CATEGORIES,
    PROCEDENCIA_OPTIONS,
    FONASA_LEVELS
} from './examCategories';
export type { ExamCategory } from './examCategories';
