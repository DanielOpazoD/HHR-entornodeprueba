/**
 * Email Constants and Builders
 * 
 * ## EMAIL FORMAT SPECIFICATION
 * 
 * The census email is sent in **PLAIN TEXT** format for maximum compatibility.
 * 
 * **Structure:**
 * ```
 * Estimados.
 * 
 * Junto con saludar, envío adjunto planilla estadística de pacientes 
 * hospitalizados correspondiente al día X de [mes] de [año].
 * 
 * Clave Excel: XXXXXX (6-digit numeric PIN)
 * 
 * Saludos cordiales
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ (Unicode separator)
 * [Nurse Names from Census]
 * Enfermería - Servicio Hospitalizados
 * Hospital Hanga Roa
 * Anexo MINSAL 328388
 * ```
 * 
 * **Important:**
 * - PIN is a 6-digit number generated deterministically from the date
 * - Nurse signature comes from `nursesSignature` parameter (typically from Census)
 * - Plain text format ensures compatibility with all email clients
 */
import { formatDateDDMMYYYY } from '@/utils/dateUtils';

// Recipients should be configured via admin panel or passed explicitly
// Empty by default - no hardcoded emails
export const CENSUS_DEFAULT_RECIPIENTS: string[] = [];

// Use simple hyphen to avoid encoding issues
export const buildCensusEmailSubject = (date: string) => `Censo diario pacientes hospitalizados - ${formatDateDDMMYYYY(date)}`;

/**
 * Builds the census email body in plain text format.
 */
export const buildCensusEmailBody = (date: string, nursesSignature?: string, encryptionPin?: string): string => {
    // Parse date to get day, month name, year
    const [year, month, day] = date.split('-');
    const monthNames = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const monthName = monthNames[parseInt(month, 10) - 1] || month;
    const dayNum = parseInt(day, 10);

    // Security note - simple format without emoji
    const securityNote = encryptionPin
        ? `Clave Excel: ${encryptionPin}`
        : '';

    // Visual separator using Unicode horizontal lines
    const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    // Nurse signature block
    const signatureBlock = nursesSignature
        ? `${separator}${nursesSignature}\nEnfermería - Servicio Hospitalizados\nHospital Hanga Roa\nAnexo MINSAL 328388`
        : `${separator}Enfermería - Servicio Hospitalizados\nHospital Hanga Roa\nAnexo MINSAL 328388`;

    return [
        'Estimados:',
        '',
        `Junto con saludar, les envío adjunta la planilla estadística de pacientes hospitalizados correspondiente al ${dayNum} de ${monthName} de ${year}.`,
        securityNote,
        'Saludos cordiales,',
        signatureBlock
    ].join('\n');
};
