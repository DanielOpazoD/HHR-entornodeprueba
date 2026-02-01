/**
 * Google Drive Service
 * Handles file uploads and online editing integration via Google Drive API.
 * 
 * This service uses the Google Identity Services (GSI) Token Model for authorization.
 */

interface TokenClient {
    requestAccessToken: () => void;
}

interface TokenResponse {
    access_token: string;
    expires_in: number;
    error?: unknown;
}

declare global {
    interface Window {
        google: {
            accounts: {
                oauth2: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        callback: (response: TokenResponse) => void;
                    }) => TokenClient;
                };
            };
        };
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
                callback: (response: TokenResponse) => {
                    if (response.error) {
                        console.error('[GoogleDrive] Auth error:', response.error);
                        reject(response);
                        return;
                    }

                    accessToken = response.access_token;
                    // Usually tokens expire in 3600 seconds
                    tokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;

                    // console.debug('[GoogleDrive] Access token acquired');
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
        // console.info(`[GoogleDrive] Uploading ${fileName}...`);
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
        // console.info('[GoogleDrive] Upload successful:', data.id);

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

// ============================================================================
// Folder Management
// ============================================================================

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

const MONTHS_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Finds a folder by name within a parent folder
 * @returns Folder ID if found, null otherwise
 */
const findFolderByName = async (
    token: string,
    folderName: string,
    parentId?: string
): Promise<string | null> => {
    try {
        let query = `name='${folderName}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
        if (parentId) {
            query += ` and '${parentId}' in parents`;
        }

        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.files?.[0]?.id || null;
    } catch {
        return null;
    }
};

/**
 * Finds a file by name within a parent folder
 * @returns File ID if found, null otherwise
 */
const findFileByName = async (
    token: string,
    fileName: string,
    parentId: string
): Promise<string | null> => {
    try {
        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.files?.[0]?.id || null;
    } catch {
        return null;
    }
};

/**
 * Updates an existing file in Google Drive (overwrite content)
 */
const updateFileContent = async (
    token: string,
    fileId: string,
    blob: Blob
): Promise<{ fileId: string; webViewLink: string }> => {
    const boundary = 'foo_bar_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const reader = new FileReader();
    const base64DataPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(blob);
    });

    const base64Data = await base64DataPromise;

    const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        '{}' + // Empty metadata for update
        delimiter +
        `Content-Type: ${blob.type}\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Data +
        closeDelimiter;

    // Use PATCH to update existing file
    const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,webViewLink`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
        }
    );

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Update failed: ${errorData.error?.message}`);
    }

    const data = await response.json();
    // console.info(`[GoogleDrive] File updated: ${fileId}`);
    return { fileId: data.id, webViewLink: data.webViewLink };
};

/**
 * Creates a folder in Google Drive
 * @returns The created folder's ID
 */
const createFolder = async (
    token: string,
    folderName: string,
    parentId?: string
): Promise<string> => {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
        name: folderName,
        mimeType: FOLDER_MIME_TYPE,
    };

    if (parentId) {
        metadata.parents = [parentId];
    }

    const response = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to create folder: ${error.error?.message}`);
    }

    const data = await response.json();
    // console.info(`[GoogleDrive] Created folder: ${folderName} (${data.id})`);
    return data.id;
};

/**
 * Gets or creates a folder (creates if it doesn't exist)
 */
const getOrCreateFolder = async (
    token: string,
    folderName: string,
    parentId?: string
): Promise<string> => {
    const existingId = await findFolderByName(token, folderName, parentId);
    if (existingId) {
        // console.debug(`[GoogleDrive] Found existing folder: ${folderName}`);
        return existingId;
    }
    return await createFolder(token, folderName, parentId);
};

/**
 * Uploads a file to a specific folder in Google Drive
 * If file with same name exists, it will be OVERWRITTEN (updated)
 */
const uploadToFolder = async (
    token: string,
    blob: Blob,
    fileName: string,
    folderId: string
): Promise<{ fileId: string; webViewLink: string }> => {
    // Check if file already exists in this folder
    const existingFileId = await findFileByName(token, fileName, folderId);

    if (existingFileId) {
        // console.info(`[GoogleDrive] File "${fileName}" already exists, overwriting...`);
        return await updateFileContent(token, existingFileId, blob);
    }

    // File doesn't exist, create new one
    // console.info(`[GoogleDrive] Creating new file: ${fileName}`);
    const metadata = {
        name: fileName,
        mimeType: blob.type,
        parents: [folderId],
    };

    const boundary = 'foo_bar_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const reader = new FileReader();
    const base64DataPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
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
        throw new Error(`Upload failed: ${errorData.error?.message}`);
    }

    const data = await response.json();
    return { fileId: data.id, webViewLink: data.webViewLink };
};

// ============================================================================
// Transfer-specific Upload with Folder Structure
// ============================================================================

export interface TransferUploadOptions {
    patientName: string;
    patientRut: string;
}

/**
 * Uploads a file to the organized transfer folder structure:
 * Traslados HHR / Año / Mes / Nombre_Apellido_RUT
 */
export const uploadToTransferFolder = async (
    blob: Blob,
    fileName: string,
    options: TransferUploadOptions
): Promise<{ fileId: string; webViewLink: string; folderPath: string }> => {
    const token = await requestAccessToken();
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = MONTHS_ES[now.getMonth()];

    // Clean patient name and RUT for folder name
    const cleanName = options.patientName.trim().replace(/\s+/g, '_');
    const cleanRut = options.patientRut.replace(/[.-]/g, '');
    const patientFolder = `${cleanName}_${cleanRut}`;

    // console.info(`[GoogleDrive] Creating folder structure: Traslados HHR / ${year} / ${month} / ${patientFolder}`);

    // Build folder hierarchy
    const rootFolderId = await getOrCreateFolder(token, 'Traslados HHR');
    const yearFolderId = await getOrCreateFolder(token, year, rootFolderId);
    const monthFolderId = await getOrCreateFolder(token, month, yearFolderId);
    const patientFolderId = await getOrCreateFolder(token, patientFolder, monthFolderId);

    // Upload file to patient folder
    // console.info(`[GoogleDrive] Uploading ${fileName} to patient folder...`);
    const result = await uploadToFolder(token, blob, fileName, patientFolderId);

    // console.info('[GoogleDrive] Upload to structured folder complete:', result.fileId);

    return {
        ...result,
        folderPath: `Traslados HHR/${year}/${month}/${patientFolder}`
    };
};
