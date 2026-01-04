/**
 * Authorized Emails for Public Census Access
 * 
 * This list controls who can access the shared census view.
 * Unlike the main app login (which is very restrictive),
 * this is a separate "public layer" for external viewers.
 * 
 * To add new authorized emails, simply add them to this list.
 */

export const CENSUS_AUTHORIZED_EMAILS: string[] = [
    // Hospital Hanga Roa Staff
    'arenka.palma@hospitalhangaroa.cl',
    'natalia.arzola@hospitalhangaroa.cl',
    'vaitiare.hereveri@hospitalhangaroa.cl',
    'kaany.pakomio@hospitalhangaroa.cl',
    'claudia.salgado@hospitalhangaroa.cl',
    'bianca.atam@hospitalhangaroa.cl',
    'ana.pont@hospitalhangaroa.cl',
    'katherin.pont@hospitalhangaroa.cl',
    'eyleen.cisternas@hospitalhangaroa.cl',
    'marco.ramirez@hospitalhangaroa.cl',
    'josemiguel.villavicencio@hospitalhangaroa.cl',
    'carla.curinao@hospitalhangaroa.cl',
    'epidemiologia@hospitalhangaroa.cl',
    'archivosome@hospitalhangaroa.cl',
    'antonio.espinoza@hospitalhangaroa.cl',
    'juan.pakomio@hospitalhangaroa.cl',
    'ivan.pulgar@hospitalhangaroa.cl',
    'daniel.opazo@hospitalhangaroa.cl',

    // Salud Oriente (External)
    'andrea.saldana@saludoriente.cl',
    'patricio.medina@saludoriente.cl',
    'gestion.camas@saludoriente.cl',

    // Admin/Development
    'd.opazo.damiani@gmail.com',
    'd.opazo.damiani@hospitalhangaroa.cl',
    'danieel.aod@gmail.com',  // Test account
];

/**
 * Checks if an email is authorized to view the shared census
 * @param email - The email to check (case-insensitive)
 * @returns true if the email is in the authorized list
 */
export function isEmailAuthorizedForCensus(email: string | null | undefined): boolean {
    if (!email) return false;

    const normalizedEmail = email.toLowerCase().trim();
    return CENSUS_AUTHORIZED_EMAILS.some(
        authorized => authorized.toLowerCase() === normalizedEmail
    );
}

/**
 * Checks if an email domain is from Hospital Hanga Roa
 * (Useful for allowing all hospital staff in the future)
 */
export function isHospitalDomain(email: string | null | undefined): boolean {
    if (!email) return false;
    return email.toLowerCase().endsWith('@hospitalhangaroa.cl');
}
