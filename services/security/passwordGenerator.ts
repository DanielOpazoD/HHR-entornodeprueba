/**
 * Export Password Generator
 * 
 * Pure function to generate deterministic passwords for census Excel exports.
 * This module has NO Firebase dependencies and can be used in both browser and Node.js.
 * 
 * For Firestore persistence, use exportPasswordService.ts instead.
 */

// Secret salt for password generation (should match across client and server)
const PASSWORD_SALT = 'HHR-CENSO-2025';

/**
 * Generate a deterministic 6-digit numeric PIN for a census date.
 * Uses a hash-based approach to ensure the same date always produces the same PIN.
 * 
 * @param censusDate - The census date in YYYY-MM-DD format
 * @returns A 6-digit numeric PIN
 */
export const generateCensusPassword = (censusDate: string): string => {
    const input = `${PASSWORD_SALT}-${censusDate}`;

    // Simple hash function (djb2 algorithm variant)
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to positive number and ensure we have at least 6 digits
    // We use modulo 1,000,000 to get a 6-digit number
    const numericHash = Math.abs(hash);
    const pin = (numericHash % 1000000).toString().padStart(6, '0');

    return pin;
};

/**
 * Alias for generateCensusPassword for backwards compatibility.
 */
export const getCensusPassword = generateCensusPassword;
