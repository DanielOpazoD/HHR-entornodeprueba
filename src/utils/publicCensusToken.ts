/**
 * Simple Token Utility for Public Census Access
 * 
 * Generates and validates tokens for accessing the shared census view
 * without requiring Firebase authentication.
 */

// Secret key for token generation (in production, use env variable)
const TOKEN_SECRET = 'hhr-censo-2026';

/**
 * Generates a simple access token valid for the current period
 * Token format: base64(month-year-secret-hash)
 */
export function generatePublicCensusToken(): string {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    // Create a simple hash based on current month/year
    const payload = `${month}-${year}-${TOKEN_SECRET}`;
    const hash = simpleHash(payload);

    // Encode as base64 for URL safety
    const token = btoa(`${month}:${year}:${hash}`);
    return token;
}

/**
 * Validates a public census token
 * Returns true if the token is valid for current or previous month
 */
export function validatePublicCensusToken(token: string): boolean {
    if (!token) return false;

    try {
        const decoded = atob(token);
        const [monthStr, yearStr, providedHash] = decoded.split(':');
        const tokenMonth = parseInt(monthStr, 10);
        const tokenYear = parseInt(yearStr, 10);

        // Regenerate expected hash
        const expectedPayload = `${tokenMonth}-${tokenYear}-${TOKEN_SECRET}`;
        const expectedHash = simpleHash(expectedPayload);

        if (providedHash !== expectedHash) {
            return false;
        }

        // Check if token is for current or previous month
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Calculate previous month
        let prevMonth = currentMonth - 1;
        let prevYear = currentYear;
        if (prevMonth < 0) {
            prevMonth = 11;
            prevYear--;
        }

        // Token is valid if it matches current or previous month
        const isCurrentMonth = tokenMonth === currentMonth && tokenYear === currentYear;
        const isPrevMonth = tokenMonth === prevMonth && tokenYear === prevYear;

        return isCurrentMonth || isPrevMonth;
    } catch (e) {
        console.warn('[TokenUtils] Invalid token format:', e);
        return false;
    }
}

/**
 * Simple hash function for token generation
 * Not cryptographically secure, but sufficient for access tokens
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Generates the full URL for public census access
 */
export function generatePublicCensusUrl(): string {
    const token = generatePublicCensusToken();
    const baseUrl = window.location.origin;
    return `${baseUrl}/censo-publico?token=${token}`;
}
