/**
 * Excel Validation Utilities
 * 
 * Functions to validate Excel files before download or email attachment.
 * Helps prevent corrupt or empty files from being distributed.
 */

// Minimum size for a valid Excel file (empty workbook ~4KB, with data typically >10KB)
export const MIN_EXCEL_SIZE = 5000; // 5KB

// MIME type for XLSX files
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Validates an Excel buffer by checking:
 * 1. Buffer is not null/undefined
 * 2. Buffer has minimum size (prevents empty files)
 * 3. Buffer starts with ZIP magic bytes (XLSX is a ZIP archive)
 * 
 * @param buffer - The ArrayBuffer or Buffer to validate
 * @returns Object with valid flag and optional error message
 */
export function validateExcelBuffer(buffer: ArrayBuffer | Buffer | Uint8Array | null | undefined): {
    valid: boolean;
    error?: string;
} {
    if (!buffer) {
        return { valid: false, error: 'El buffer del archivo es nulo o indefinido.' };
    }

    const byteLength = buffer.byteLength ?? (buffer as Buffer).length ?? 0;

    if (byteLength < MIN_EXCEL_SIZE) {
        return {
            valid: false,
            error: `El archivo es muy pequeño (${byteLength} bytes). Mínimo esperado: ${MIN_EXCEL_SIZE} bytes.`
        };
    }

    // Check for ZIP magic bytes (PK..)
    // XLSX files are ZIP archives and must start with 0x50 0x4B (ASCII "PK")
    // Convert to Uint8Array for consistent byte access
    let firstBytes: Uint8Array;
    if (buffer instanceof Uint8Array) {
        firstBytes = buffer.subarray(0, 4);
    } else if (buffer instanceof ArrayBuffer) {
        firstBytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    } else {
        // Node.js Buffer - use subarray which is available on Buffer
        firstBytes = new Uint8Array((buffer as Buffer).subarray(0, 4));
    }

    const isZipArchive = firstBytes[0] === 0x50 && firstBytes[1] === 0x4B;

    if (!isZipArchive) {
        return {
            valid: false,
            error: 'El archivo no tiene el formato XLSX esperado (no es un archivo ZIP válido).'
        };
    }

    return { valid: true };
}

/**
 * Validates that a filename has the correct .xlsx extension
 * 
 * @param filename - The filename to validate
 * @returns Object with valid flag and optional error message
 */
export function validateExcelFilename(filename: string | null | undefined): {
    valid: boolean;
    error?: string;
} {
    if (!filename || typeof filename !== 'string') {
        return { valid: false, error: 'El nombre del archivo es inválido.' };
    }

    const trimmed = filename.trim();

    if (trimmed.length === 0) {
        return { valid: false, error: 'El nombre del archivo está vacío.' };
    }

    if (!trimmed.toLowerCase().endsWith('.xlsx')) {
        return {
            valid: false,
            error: `El archivo debe terminar en .xlsx. Nombre actual: "${trimmed}"`
        };
    }

    return { valid: true };
}

/**
 * Combined validation for Excel export
 * Validates both buffer and filename
 * 
 * @param buffer - The Excel buffer
 * @param filename - The filename
 * @returns Object with valid flag and optional error message
 */
export function validateExcelExport(
    buffer: ArrayBuffer | Buffer | Uint8Array | null | undefined,
    filename: string | null | undefined
): {
    valid: boolean;
    error?: string;
} {
    const bufferValidation = validateExcelBuffer(buffer);
    if (!bufferValidation.valid) {
        return bufferValidation;
    }

    const filenameValidation = validateExcelFilename(filename);
    if (!filenameValidation.valid) {
        return filenameValidation;
    }

    return { valid: true };
}
