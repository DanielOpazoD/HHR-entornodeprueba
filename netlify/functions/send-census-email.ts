import { CENSUS_DEFAULT_RECIPIENTS } from '../../constants/email';
import { buildCensusMasterBuffer, getCensusMasterFilename } from '../../services/exporters/censusMasterWorkbook';
import { validateExcelBuffer, validateExcelFilename, MIN_EXCEL_SIZE } from '../../services/exporters/excelValidation';
import { sendCensusEmail } from '../../services/email/gmailClient';
import type { DailyRecord } from '../../types';

const ALLOWED_ROLES = ['nurse_hospital', 'admin'];

interface NetlifyEvent {
    httpMethod: string;
    headers: Record<string, string | undefined>;
    body: string | null;
    [key: string]: unknown;
}

export const handler = async (event: NetlifyEvent) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Método no permitido'
        };
    }

    const requesterRole = (event.headers['x-user-role'] || event.headers['X-User-Role']) as string | undefined;
    if (!requesterRole || !ALLOWED_ROLES.includes(requesterRole)) {
        return {
            statusCode: 403,
            body: 'No autorizado para enviar correos de censo.'
        };
    }

    if (!event.body) {
        return {
            statusCode: 400,
            body: 'Solicitud inválida: falta el cuerpo.'
        };
    }

    try {
        const payload = JSON.parse(event.body);
        const { date, records, recipients, nursesSignature, body, shareLink } = payload as {
            date: string;
            records: DailyRecord[];
            recipients?: string[];
            nursesSignature?: string;
            body?: string;
            shareLink?: string;
        };

        if (!date || !Array.isArray(records) || records.length === 0) {
            return {
                statusCode: 400,
                body: 'Solicitud inválida: falta la fecha o los datos del censo.'
            };
        }

        const monthRecords = records
            .filter((r): r is DailyRecord => Boolean(r?.date))
            .sort((a, b) => a.date.localeCompare(b.date));

        if (monthRecords.length === 0) {
            return {
                statusCode: 400,
                body: 'No hay registros disponibles para generar el Excel maestro.'
            };
        }

        const attachmentBufferRaw = await buildCensusMasterBuffer(monthRecords);
        const attachmentName = getCensusMasterFilename(date);

        // Validate buffer before proceeding
        const bufferValidation = validateExcelBuffer(attachmentBufferRaw);
        if (!bufferValidation.valid) {
            console.error('[CensusEmail] Buffer validation failed:', bufferValidation.error);
            return {
                statusCode: 500,
                body: `Error: El archivo Excel generado es inválido. ${bufferValidation.error} No se enviará el correo.`
            };
        }

        // Validate filename
        const filenameValidation = validateExcelFilename(attachmentName);
        if (!filenameValidation.valid) {
            console.error('[CensusEmail] Filename validation failed:', filenameValidation.error);
            return {
                statusCode: 500,
                body: `Error: El nombre del archivo es inválido. ${filenameValidation.error}`
            };
        }

        // Generate deterministic password based on census date
        const { generateCensusPassword } = await import('../../services/security/passwordGenerator');
        const password = shareLink ? '' : generateCensusPassword(date);

        // Ensure the PIN or Link is included in the email body
        let finalBody = body || '';

        if (shareLink) {
            const linkText = `Link de Acceso Seguro: ${shareLink}`;
            const instructions = `Este link le permitirá visualizar el censo de este mes y el anterior directamente en la plataforma.`;
            const shareBlock = `${linkText}\n${instructions}`;

            if (finalBody.includes('Saludos cordiales,')) {
                finalBody = finalBody.replace('Saludos cordiales,', `${shareBlock}\n\nSaludos cordiales,`);
            } else if (finalBody.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
                finalBody = finalBody.replace('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', `${shareBlock}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            } else {
                finalBody = finalBody ? `${finalBody}\n\n${shareBlock}` : shareBlock;
            }
        } else if (password && !finalBody.includes(password)) {
            const pinLine = `Clave Excel: ${password}`;
            // ... (keep existing logic for PIN insertion)
            if (finalBody.includes('Saludos cordiales,')) {
                finalBody = finalBody.replace('Saludos cordiales,', `${pinLine}\n\nSaludos cordiales,`);
            } else if (finalBody.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
                finalBody = finalBody.replace('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', `${pinLine}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            } else {
                finalBody = finalBody ? `${finalBody}\n\n${pinLine}` : pinLine;
            }
        }

        let attachmentBuffer = null;
        if (!shareLink) {

            const XlsxPopulate = require('xlsx-populate');
            attachmentBuffer = await XlsxPopulate.fromDataAsync(attachmentBufferRaw)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((workbook: any) => workbook.outputAsync({ password }));

            // Validate encrypted buffer
            if (!attachmentBuffer || attachmentBuffer.length < MIN_EXCEL_SIZE) {
                console.error('[CensusEmail] Encrypted buffer validation failed: buffer is too small or empty');
                return {
                    statusCode: 500,
                    body: 'Error: El archivo Excel encriptado es inválido o está vacío. No se enviará el correo.'
                };
            }
        }

        // Validate encrypted buffer
        if (!attachmentBuffer || attachmentBuffer.length < MIN_EXCEL_SIZE) {
            console.error('[CensusEmail] Encrypted buffer validation failed: buffer is too small or empty');
            return {
                statusCode: 500,
                body: 'Error: El archivo Excel encriptado es inválido o está vacío. No se enviará el correo.'
            };
        }

        const resolvedRecipients: string[] = Array.isArray(recipients) && recipients.length > 0
            ? recipients
            : CENSUS_DEFAULT_RECIPIENTS;

        const gmailResponse = await sendCensusEmail({
            date,
            recipients: resolvedRecipients,
            attachmentBuffer: attachmentBuffer || undefined,
            attachmentName: shareLink ? undefined : attachmentName,
            nursesSignature,
            body: finalBody,
            encryptionPin: password || undefined
        });

        // eslint-disable-next-line no-console
        console.log('Gmail send response', gmailResponse);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Correo enviado correctamente.',
                gmailId: gmailResponse.id,
                censusDate: date,
                exportPassword: password
            })
        };
    } catch (error: unknown) {
        console.error('Error enviando correo de censo', error);
        const message = error instanceof Error ? error.message : 'Error desconocido enviando el correo.';
        return {
            statusCode: 500,
            body: message
        };
    }
};
