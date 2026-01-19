/**
 * Centralized identity constants for Hospital Hanga Roa.
 * This ensures consistency across the application, authentication, and database rules.
 */

export const INSTITUTIONAL_ACCOUNTS = {
    /** Primary nursing account for census and handoff operations */
    NURSING: 'hospitalizados@hospitalhangaroa.cl',

    /** Legacy or alternative names to be redirected/mapped to the primary one */
    NURSING_ALT: 'enfermeria.hospitalizados@hospitalhangaroa.cl',
} as const;

export const ADMIN_EMAILS = [
    'daniel.opazo@hospitalhangaroa.cl',
    'd.opazo.damiani@gmail.com',
    'd.opazo.damiani@hospitalhangaroa.cl',
    'danielopazodamiani@gmail.com',
    INSTITUTIONAL_ACCOUNTS.NURSING
] as const;

/**
 * Helper to check if an email is an institutional/service account
 */
export const isInstitutionalAccount = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();
    return (Object.values(INSTITUTIONAL_ACCOUNTS) as string[]).includes(cleanEmail);
};

/**
 * Helper to check if an email belongs to an administrator
 */
export const isAdministratorEmail = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();
    return (ADMIN_EMAILS as readonly string[]).includes(cleanEmail);
};
