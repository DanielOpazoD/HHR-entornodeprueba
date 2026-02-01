/**
 * Utils Index
 * Centralized exports for all utility functions.
 * 
 * Usage: import { formatDateDDMMYYYY, isValidRut, escapeCsvValue } from './utils';
 */

// Date utilities
export {
    formatDateDDMMYYYY,
    getTodayISO,
    formatDateForDisplay,
    daysBetween,
    getTimeRoundedToStep,
    isFutureDate,
    parseISODate
} from './dateUtils';

// String utilities
export {
    capitalizeWords,
    normalizeName,
    truncate,
    isEmpty,
    removeAccents,
    searchMatch
} from './stringUtils';

// CSV utilities
export {
    escapeCsvValue,
    arrayToCsv,
    downloadCsv
} from './csvUtils';

// RUT/ID validation
export {
    cleanRut,
    formatRut,
    calculateRutVerifier,
    isValidRut,
    isPassportFormat
} from './rutUtils';

// Array utilities
export {
    randomItem,
    shuffle,
    groupBy,
    unique,
    uniqueBy
} from './arrayUtils';
