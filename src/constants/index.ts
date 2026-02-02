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
    ADMISSION_ORIGIN_OPTIONS,
    DEVICE_OPTIONS,
    VVP_DEVICE_KEYS,
    EVACUATION_METHODS,
    RECEIVING_CENTERS
} from './clinical';
export type {
    AdmissionOrigin,
    DeviceType,
    EvacuationMethod,
    ReceivingCenter
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

