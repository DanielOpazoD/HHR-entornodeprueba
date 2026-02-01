/**
 * RUT/ID Validation Utilities
 * Pure functions for Chilean RUT validation.
 */

/**
 * Clean RUT string (remove dots and dashes)
 */
export const cleanRut = (rut: string): string => {
    return rut.replace(/[.-]/g, '').toUpperCase();
};

/**
 * Format RUT with dots and dash
 * Example: "123456789" -> "12.345.678-9"
 */
export const formatRut = (rut: string): string => {
    const cleaned = cleanRut(rut);
    if (cleaned.length < 2) return rut;

    const body = cleaned.slice(0, -1);
    const verifier = cleaned.slice(-1);

    // Add dots every 3 digits from right
    const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    return `${formatted}-${verifier}`;
};

/**
 * Calculate RUT verification digit
 */
export const calculateRutVerifier = (rutBody: string): string => {
    const cleaned = rutBody.replace(/\D/g, '');
    let sum = 0;
    let multiplier = 2;

    for (let i = cleaned.length - 1; i >= 0; i--) {
        sum += parseInt(cleaned[i]) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const remainder = 11 - (sum % 11);

    if (remainder === 11) return '0';
    if (remainder === 10) return 'K';
    return remainder.toString();
};

/**
 * Validate Chilean RUT
 */
export const isValidRut = (rut: string): boolean => {
    if (!rut) return false;

    // 1. Clean RUT (remove dots and dashes) and match user's logic
    const cleaned = rut.replace(/[^0-9kK]/g, '').toUpperCase();

    // 2. Minimum length check as requested
    if (cleaned.length < 8) return false;

    const body = cleaned.slice(0, -1);
    const verifier = cleaned.slice(-1);

    // 3. Check body is numeric
    if (!/^\d+$/.test(body)) return false;

    // 4. Calculate and compare verifier (using existing robust logic)
    const expectedVerifier = calculateRutVerifier(body);
    return verifier === expectedVerifier;
};

/**
 * Check if value looks like a passport (not a RUT)
 */
export const isPassportFormat = (value: string): boolean => {
    if (!value) return false;
    // Passport: starts with letter or has letters in middle
    const cleaned = value.replace(/[\s-.]/g, '');
    return /^[A-Za-z]/.test(cleaned) || /[A-Za-z]{2,}/.test(cleaned);
};
