/**
 * Export Password Generator
 *
 * Generates a deterministic monthly password for census Excel exports.
 * This module has NO Firebase dependencies and can be used in both browser and Node.js.
 *
 * For Firestore persistence, use exportPasswordService.ts instead.
 */

/**
 * Generate a deterministic 4-digit monthly PIN for a census date.
 * All dates within the same month share the same password, using the month repeated twice.
 * Examples: January -> 0101, April -> 0404, December -> 1212.
 *
 * @param censusDate - The census date in YYYY-MM-DD format
 * @returns A 4-digit numeric PIN
 */
export const generateCensusPassword = (censusDate: string): string => {
  const [, month = ''] = censusDate.split('-');
  const normalizedMonth = month.padStart(2, '0').slice(0, 2);

  if (!/^\d{2}$/.test(normalizedMonth) || normalizedMonth === '00') {
    throw new Error(`Invalid census date for monthly password generation: ${censusDate}`);
  }

  return `${normalizedMonth}${normalizedMonth}`;
};

/**
 * Alias for generateCensusPassword for backwards compatibility.
 */
export const getCensusPassword = generateCensusPassword;
