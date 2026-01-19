import { DailyRecord } from '../../types';
import { CENSUS_DEFAULT_RECIPIENTS } from '../../constants/email';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getExportPasswordsPath } from '../../constants/firestorePaths';

interface TriggerEmailParams {
    date: string;
    records: DailyRecord[];
    recipients?: string[];
    nursesSignature?: string;
    body?: string;
    shareLink?: string;
    userEmail?: string | null;
    userRole?: string | null;
}

interface EmailResponse {
    success: boolean;
    message: string;
    gmailId: string;
    censusDate?: string;
    exportPassword?: string;
}

const ENDPOINT = '/.netlify/functions/send-census-email';

// Check if we're in development mode (Vite dev server)
const isDevelopment = import.meta.env.DEV;

/**
 * Save export password to Firestore for audit purposes
 */
const saveExportPassword = async (date: string, password: string, createdBy?: string): Promise<void> => {
    try {
        const db = getFirestore();
        const passwordsPath = getExportPasswordsPath();
        const docRef = doc(db, passwordsPath, date);

        await setDoc(docRef, {
            date,
            password,
            createdAt: new Date().toISOString(),
            createdBy,
            source: 'email'
        }, { merge: true });

        // console.debug(`[CensusEmail] Password saved to Firestore for ${date}`);
    } catch (error) {
        console.error('[CensusEmail] Failed to save password to Firestore:', error);
        // Don't throw - email was sent successfully, this is just for audit
    }
};

export const triggerCensusEmail = async (params: TriggerEmailParams): Promise<EmailResponse> => {
    const { date, records, recipients, nursesSignature, body, shareLink, userEmail, userRole } = params;


    // In development, Netlify functions are not available
    if (isDevelopment) {
        console.warn('[CensusEmail] Modo desarrollo - el envío de correo solo funciona en Netlify.');
        console.warn('[CensusEmail] Datos que se enviarían:', {
            date,
            recipientCount: recipients?.length || CENSUS_DEFAULT_RECIPIENTS.length,
            recordCount: records.length,
        });

        // Show a user-friendly message instead of crashing
        throw new Error('El envío de correo automático solo está disponible cuando la aplicación está desplegada en Netlify. En desarrollo local, puedes verificar los datos en la consola.');
    }

    // Validate recipients - must be provided explicitly since no hardcoded defaults
    const finalRecipients = recipients && recipients.length > 0 ? recipients : CENSUS_DEFAULT_RECIPIENTS;

    if (finalRecipients.length === 0) {
        throw new Error('No se especificaron destinatarios para el correo. Configure los destinatarios antes de enviar.');
    }

    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-user-email': userEmail || '',
            'x-user-role': userRole || ''
        },
        body: JSON.stringify({
            date,
            records,
            recipients: finalRecipients,
            nursesSignature,
            body,
            shareLink
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'No se pudo enviar el correo.');
    }

    const result: EmailResponse = await response.json();

    // Save password to Firestore for audit purposes
    if (result.exportPassword && result.censusDate) {
        await saveExportPassword(result.censusDate, result.exportPassword, userEmail || undefined);
    }

    return result;
};
