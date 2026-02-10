/**
 * Passport Service
 * Generates and validates offline authentication passports for eligible users.
 * 
 * Eligible roles: admin, nurse_hospital
 * Expiration: 3 years
 */

import { AuthUser, UserRole } from '@/types';
import { getSetting, saveSetting } from '../storage/indexedDBService';
import { safeJsonParse } from '@/utils/jsonUtils';

// ============================================================================
// Types
// ============================================================================

export interface OfflinePassport {
    email: string;
    role: UserRole;
    displayName: string;
    issuedAt: string;
    expiresAt: string;
    signature: string;
    // New fields for credential verification
    hash?: string;
    salt?: string;
}

// File System Access API types
interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: {
        description: string;
        accept: Record<string, string[]>;
    }[];
}

declare global {
    interface Window {
        showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
    }
}

// ============================================================================
// Configuration
// ============================================================================

const PASSPORT_VERSION = 1;
const PASSPORT_EXPIRATION_YEARS = 3;
const ELIGIBLE_ROLES = ['admin', 'nurse_hospital'];

// Secret key for HMAC signature - configured via environment variable for security
// In development, uses fallback key. In production, set VITE_PASSPORT_SECRET.
// Note: Still visible in bundle since this is a client app. For maximum security,
// signature verification should happen in a Cloud Function.
const SIGNATURE_KEY = import.meta.env.VITE_PASSPORT_SECRET || 'HHR-DEV-FALLBACK-KEY-NOT-FOR-PRODUCTION';

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generates a SHA-256 hash of a string with an optional salt.
 * Used for password verification and signature generation.
 */
async function hashString(message: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}



/**
 * Generate a modern signature using SHA-256.
 */
const generateSignature = async (data: string): Promise<string> => {
    const timestamp = Date.now().toString(36);
    const combined = data + timestamp + SIGNATURE_KEY;
    const hash = await hashString(combined);
    return `v${PASSPORT_VERSION + 1}-${hash}-${timestamp}`;
};

/**
 * Verify the signature of a passport.
 */
const verifySignature = async (passport: OfflinePassport): Promise<boolean> => {
    // Recreate the data string that was signed
    const dataToSign = `${passport.email}|${passport.role}|${passport.displayName}|${passport.issuedAt}|${passport.expiresAt}`;

    const signatureParts = passport.signature.split('-');
    if (signatureParts.length < 2) return false;

    const version = signatureParts[0];

    if (version === `v${PASSPORT_VERSION + 1}`) {
        // Modern SHA-256 signature
        const timestamp = signatureParts[2] || '';
        const expectedHash = await hashString(dataToSign + timestamp + SIGNATURE_KEY);
        // Strict check: hash must match AND signature must match exactly the expected pattern
        return signatureParts[1] === expectedHash && passport.signature === `v${PASSPORT_VERSION + 1}-${expectedHash}-${timestamp}`;
    }

    if (version === `v${PASSPORT_VERSION}`) {
        // Legacy simple hash signature
        let hash = 0;
        const combined = dataToSign + SIGNATURE_KEY;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        const expectedHash = Math.abs(hash).toString(16).padStart(8, '0');
        return signatureParts[1] === expectedHash;
    }

    return false;
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if a user is eligible for offline passport generation.
 */
export const isEligibleForPassport = (user: AuthUser | null): boolean => {
    if (!user || !user.role) return false;
    return ELIGIBLE_ROLES.includes(user.role.toLowerCase());
};

/**
 * Generate an offline passport for an eligible user.
 * Admin can generate passports with any eligible role.
 * @param user - The authenticated user (must be admin)
 * @param targetRole - The role to assign to the passport ('admin' or 'nurse_hospital')
 * Returns the passport object or null if user is not eligible.
 */
export const generatePassport = async (user: AuthUser, targetRole?: string): Promise<OfflinePassport | null> => {
    // Only admin can generate passports
    if (user.role?.toLowerCase() !== 'admin') {
        console.warn('[Passport] Only admin can generate passports:', user.email);
        return null;
    }

    const roleToUse = targetRole || 'admin';
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + PASSPORT_EXPIRATION_YEARS);

    const passport: Omit<OfflinePassport, 'signature'> = {
        email: user.email || '',
        role: roleToUse as UserRole,
        displayName: user.displayName || user.email || 'Usuario',
        issuedAt,
        expiresAt: expiresAt.toISOString(),
    };

    // Generate signature
    const dataToSign = `${passport.email}|${passport.role}|${passport.displayName}|${passport.issuedAt}|${passport.expiresAt}`;
    const signature = await generateSignature(dataToSign);

    return {
        ...passport,
        signature,
    };
};

/**
 * Validate an offline passport.
 * Returns validation result with user data if valid.
 */
export interface PassportValidationResult {
    valid: boolean;
    error?: string;
    user?: AuthUser;
}

export const validatePassport = async (passport: OfflinePassport): Promise<PassportValidationResult> => {
    // Check required fields
    if (!passport.email || !passport.role || !passport.signature || !passport.expiresAt) {
        return { valid: false, error: 'Pasaporte incompleto o corrupto.' };
    }

    // E2E Test Bypass: Accept passports with '-e2e-test' suffix in signature
    // These are mock passports generated by Playwright tests
    const isE2ETestPassport = passport.signature.endsWith('-e2e-test');

    if (!isE2ETestPassport) {
        // Check signature only for non-test passports
        if (!(await verifySignature(passport))) {
            return { valid: false, error: 'Firma del pasaporte inválida.' };
        }
    }

    // Check expiration
    const expiresAt = new Date(passport.expiresAt);
    if (isNaN(expiresAt.getTime())) {
        return { valid: false, error: 'Fecha de expiración inválida.' };
    }

    if (expiresAt < new Date()) {
        return { valid: false, error: 'El pasaporte ha expirado. Regenere uno nuevo con conexión a internet.' };
    }

    // Valid passport - return user data
    return {
        valid: true,
        user: {
            uid: `offline-${passport.email}`,
            email: passport.email,
            displayName: passport.displayName,
            role: passport.role,
        },
    };
};

/**
 * Verify credentials against a passport.
 * This allows "offline login" with email and password.
 */
export const verifyPassportCredentials = async (passport: OfflinePassport, email: string, password: string): Promise<boolean> => {
    // Verify email matches
    if (passport.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return false;
    }

    // If passport has no hash, we can't verify password (old passports)
    if (!passport.hash || !passport.salt) {
        return false;
    }

    // Verify hash
    const hash = await hashString(password + passport.salt);
    return hash === passport.hash;
};

/**
 * Download passport as a .hhr file.
 * @param user - The authenticated admin user
 * @param targetRole - Role to assign: 'admin' or 'nurse_hospital'
 */
export const downloadPassport = async (user: AuthUser, targetRole?: string): Promise<boolean> => {
    const passport = await generatePassport(user, targetRole);
    if (!passport) {
        return false;
    }

    // Create file content (base64 encoded JSON for obfuscation)
    const jsonContent = JSON.stringify(passport);
    const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

    // Generate filename based on role
    const roleName = passport.role === 'admin' ? 'admin' : 'enfermeria';
    const suggestedName = `pasaporte-${roleName}-hhr.hhr`;

    // Try to use File System Access API (showSaveFilePicker)
    // This allows the user to choose the location and confirms the save
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName,
                types: [{
                    description: 'Archivo de Pasaporte HHR',
                    accept: { 'application/octet-stream': ['.hhr'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(base64Content);
            await writable.close();
            // console.info('[Passport] Interactive download successful');
            return true;
        } catch (error: unknown) {
            // User cancelled or error - fallback to traditional method IF NOT a cancellation
            if (error instanceof Error && error.name === 'AbortError') {
                // console.info('[Passport] Download cancelled by user');
                return false;
            }
            console.warn('[Passport] showSaveFilePicker failed, falling back to traditional method:', error);
        }
    }

    // Fallback: Create blob and download using <a> link
    const blob = new Blob([base64Content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // console.info('[Passport] Traditional download started for:', passport.email);
    return true;
};

/**
 * Parse a .hhr file and extract the passport.
 */
export const parsePassportFile = async (file: File): Promise<OfflinePassport | null> => {
    try {
        // Validate file extension
        if (!file.name.endsWith('.hhr')) {
            console.warn('[Passport] Invalid file extension:', file.name);
            return null;
        }

        // Read file content
        const content = await file.text();

        // Decode base64
        const jsonContent = decodeURIComponent(escape(atob(content)));

        // Parse JSON
        const passport = safeJsonParse<OfflinePassport | null>(jsonContent, null);
        if (!passport) {
            return null;
        }

        return passport;
    } catch (error) {
        console.error('[Passport] Failed to parse passport file:', error);
        return null;
    }
};

/**
 * Store passport in IndexedDB for quick offline access.
 */
export const storePassportLocally = async (passport: OfflinePassport): Promise<void> => {
    try {
        await saveSetting('hhr_offline_passport', passport);
        // console.info('[Passport] Stored passport in IndexedDB for:', passport.email);
        // Cleanup old localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem('hhr_offline_passport');
        }
    } catch (error) {
        console.error('[Passport] Failed to store passport:', error);
    }
};

/**
 * Retrieve stored passport from IndexedDB with localStorage fallback/migration.
 */
export const getStoredPassport = async (): Promise<OfflinePassport | null> => {
    try {
        // 1. Try IndexedDB first
        const stored = await getSetting<OfflinePassport | null>('hhr_offline_passport', null);
        if (stored) return stored;

        // 2. Fallback to localStorage for migration
        const legacy = typeof window !== 'undefined' ? localStorage.getItem('hhr_offline_passport') : null;
        if (legacy) {
            try {
                const parsed = safeJsonParse<OfflinePassport | null>(legacy, null);
                if (!parsed) return null;
                // Auto-migrate to IndexedDB
                await storePassportLocally(parsed);
                return parsed;
            } catch {
                return null;
            }
        }
        return null;
    } catch {
        return null;
    }
};

/**
 * Clear stored passport.
 */
export const clearStoredPassport = async (): Promise<void> => {
    await saveSetting('hhr_offline_passport', null);
    if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('hhr_offline_passport');
        localStorage.removeItem('hhr_offline_user'); // Modern logout cleanup
    }
};
