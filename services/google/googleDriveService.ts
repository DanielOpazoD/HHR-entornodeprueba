/**
 * Google Drive Service
 * Handles file uploads and online editing integration via Google Drive API.
 * 
 * This service uses the Google Identity Services (GSI) Token Model for authorization.
 */

declare global {
    interface Window {
        google: any;
    }
}

// Client ID should be provided via environment variables
// Fallback to a placeholder if not set
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

let accessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Checks if the current access token is valid
 */
const isTokenValid = () => {
    return accessToken && Date.now() < tokenExpiry;
};

/**
 * Requests an access token from the user using Google Identity Services (GSI)
 */
export const requestAccessToken = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        // Reuse valid token
        if (isTokenValid()) {
            resolve(accessToken!);
            return;
        }

        if (!GOOGLE_CLIENT_ID) {
            reject(new Error('VITE_GOOGLE_CLIENT_ID is not configured.'));
            return;
        }

        if (!window.google) {
            reject(new Error('Google Identity Services script not loaded.'));
            return;
        }

        try {
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: DRIVE_SCOPES,
                callback: (response: any) => {
                    if (response.error) {
                        console.error('[GoogleDrive] Auth error:', response.error);
                        reject(response);
                        return;
                    }

                    accessToken = response.access_token;
                    // Usually tokens expire in 3600 seconds
                    tokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;

                    console.log('[GoogleDrive] Access token acquired');
                    resolve(accessToken!);
                },
            });

            client.requestAccessToken();
        } catch (error) {
            console.error('[GoogleDrive] Failed to initialize token client:', error);
            reject(error);
        }
    });
};

/**
 * Uploads a Blob to Google Drive and returns the file ID and editing link.
 * 
 * @param blob The file content (DOCX or XLSX)
 * @param fileName The name for the file in Drive
 * @returns Object with fileId and webViewLink
 */
export const uploadToDrive = async (blob: Blob, fileName: string): Promise<{ fileId: string; webViewLink: string }> => {
    try {
        const token = await requestAccessToken();

        // 1. Create metadata
        const metadata = {
            name: fileName,
            mimeType: blob.type,
        };

        // 2. Build multipart body
        // Google Drive multipart upload requires a specific structure
        const boundary = 'foo_bar_boundary';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const reader = new FileReader();
        const base64DataPromise = new Promise<string>((resolve) => {
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]); // Extract base64 part
            };
            reader.readAsDataURL(blob);
        });

        const base64Data = await base64DataPromise;

        const multipartBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${blob.type}\r\n` +
            'Content-Transfer-Encoding: base64\r\n\r\n' +
            base64Data +
            closeDelimiter;

        // 3. Send request
        console.log(`[GoogleDrive] Uploading ${fileName}...`);
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[GoogleDrive] Upload failed:', errorData);
            throw new Error(`Error en subida a Google Drive: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('[GoogleDrive] Upload successful:', data.id);

        return {
            fileId: data.id,
            webViewLink: data.webViewLink
        };
    } catch (error) {
        console.error('[GoogleDrive] Error in uploadToDrive:', error);
        throw error;
    }
};

/**
 * Makes the file editable by anyone with the link (optional utility)
 */
export const makeFilePubliclyEditable = async (fileId: string): Promise<void> => {
    try {
        const token = await requestAccessToken();

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                role: 'writer',
                type: 'anyone',
            }),
        });

        if (!response.ok) {
            console.warn('[GoogleDrive] Could not set public permissions');
        }
    } catch (error) {
        console.warn('[GoogleDrive] Permission error skipped:', error);
    }
};
