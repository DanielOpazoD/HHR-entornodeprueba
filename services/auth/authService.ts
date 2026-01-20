import {
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User,
    createUserWithEmailAndPassword,
    signInAnonymously
} from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { db } from '../infrastructure/db';
import { saveSetting, getSetting } from '../storage/indexedDBService';
import { INSTITUTIONAL_ACCOUNTS } from '../../constants/identities';

/**
 * User information structure used within the application's authentication state.
 */
export interface AuthUser {
    /** Unique Firebase User ID */
    uid: string;
    /** User's email address */
    email: string | null;
    /** User's display name (usually from Google) */
    displayName: string | null;
    /** URL to user's profile picture */
    photoURL?: string | null;
    /** User's role assigned via whitelist (admin, nurse, etc.) */
    role?: string;
}

// ============================================================================
// FIRESTORE WHITELIST CHECK
// Reads allowed emails from Firestore collection 'allowedUsers'
// ============================================================================

/**
 * Check if an email is in the Firestore allowedUsers collection.
 * Returns the user document if found, null otherwise.
 */
// ============================================================================
// CONFIGURACIÓN DE ACCESOS ESTÁTICOS (Hardcoded)
// Agregar aquí correos que requieren acceso garantizado
// ============================================================================
const STATIC_ROLES: Record<string, string> = {
    [INSTITUTIONAL_ACCOUNTS.NURSING]: 'nurse_hospital',
    [INSTITUTIONAL_ACCOUNTS.NURSING_ALT]: 'nurse_hospital',
    'daniel.opazo@hospitalhangaroa.cl': 'admin',
    'd.opazo.damiani@gmail.com': 'doctor_urgency',
};

/**
 * Normaliza un correo electrónico eliminando espacios y convirtiendo a minúsculas.
 * Usar antes de cualquier verificación de permisos.
 */
const normalizeEmail = (email: string): string => {
    if (!email) return '';
    // Elimina todos los espacios (incluso internos) y convierte a minúsculas
    return String(email).toLowerCase().replace(/\s+/g, '').trim();
};

// ROLE CACHE KEY
const ROLE_CACHE_PREFIX = 'hhr_role_cache_';

/**
 * Saves a role to local storage with a timestamp.
 */
const saveRoleToCache = async (email: string, role: string) => {
    try {
        const cacheData = {
            role,
            timestamp: Date.now()
        };
        const key = `${ROLE_CACHE_PREFIX}${normalizeEmail(email)}`;
        await saveSetting(key, cacheData);
        // Cleanup legacy localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(key);
        }
    } catch (e) {
        console.warn('[authService] Failed to cache role:', e);
    }
};

/**
 * Gets a cached role if it's not older than 7 days.
 */
const getCachedRole = async (email: string): Promise<string | null> => {
    try {
        const key = `${ROLE_CACHE_PREFIX}${normalizeEmail(email)}`;

        // 1. Try IndexedDB
        let cached = await getSetting<{ role: string, timestamp: number } | null>(key, null);

        // 2. Fallback to localStorage for migration
        if (!cached && typeof window !== 'undefined' && window.localStorage) {
            const legacy = window.localStorage.getItem(key);
            if (legacy) {
                try {
                    cached = JSON.parse(legacy);
                } catch {
                    return null;
                }
            }
        }

        if (!cached) return null;

        const { role, timestamp } = cached;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        if (Date.now() - timestamp < sevenDaysMs) {
            return role;
        }
    } catch (e) {
        console.warn('[authService] Failed to read role cache:', e);
    }
    return null;
};

/**
 * Check if an email is in the Firestore allowedUsers collection.
 * Returns the user document if found, null otherwise.
 */
/**
 * Checks if an email is authorized to access the system by looking up the 'allowedUsers'
 * collection and checking against the static roles list.
 * 
 * @param email - The email address to check.
 * @returns An object indicating if allowed and their assigned role.
 */
const checkEmailInFirestore = async (email: string): Promise<{ allowed: boolean; role?: string }> => {
    // console.debug(`[authService] 🔍 Checking whitelist for: ${email}`);
    try {
        const cleanEmail = normalizeEmail(email);

        // 0. CHECK CACHE (Fastest)
        const cachedRole = await getCachedRole(cleanEmail);
        if (cachedRole) {
            // console.debug(`[authService] ⚡ Role recovered from cache: ${cachedRole}`);
            // We return but trigger a background check if possible (handled by caller)
            return { allowed: true, role: cachedRole };
        }

        // 1. VERIFICACIÓN ESTÁTICA (Prioridad alta)
        for (const [staticEmail, staticRole] of Object.entries(STATIC_ROLES)) {
            if (cleanEmail.includes(staticEmail)) {
                // console.info(`[authService] ✅ Access granted via static rule: ${cleanEmail} -> ${staticRole}`);
                await saveRoleToCache(cleanEmail, staticRole);
                return { allowed: true, role: staticRole };
            }
        }

        // console.debug(`[authService] 📡 Querying DB for whitelist...`);

        const results = await db.getDocs<any>('allowedUsers', {
            where: [{ field: 'email', operator: '==', value: email.toLowerCase().trim() }]
        });
        // console.debug(`[authService] 📥 DB response received. Results count: ${results.length}`);

        if (results.length > 0) {
            const userDoc = results[0];
            const rawRole = String(userDoc.role || 'viewer').toLowerCase().trim();
            await saveRoleToCache(cleanEmail, rawRole);
            return { allowed: true, role: rawRole };
        }

        console.warn(`[authService] ❌ Email not found in whitelist: ${email}`);
        return { allowed: false };
    } catch (error) {
        console.error('[authService] ‼️ Error checking allowed users in Firestore:', error);
        return { allowed: false };
    }
};


// ============================================================================
// Sign in with Email and Password
// ============================================================================
/**
 * Signs in a user using email and password.
 * Checks for authorization in the whitelist after successful Firebase authentication.
 * 
 * @param email - User's email address.
 * @param password - User's password.
 * @throws {Error} If credentials are invalid or if user is not in the whitelist.
 * @returns The authenticated AuthUser object.
 */
export const signIn = async (email: string, password: string): Promise<AuthUser> => {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);

        // Check if email is allowed in Firestore
        const { allowed, role } = await checkEmailInFirestore(result.user.email || '');
        if (!allowed) {
            await firebaseSignOut(auth);
            throw new Error('Acceso no autorizado. Su correo no está en la lista de usuarios permitidos.');
        }

        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
            role
        };
    } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        // Re-throw our custom authorization error
        if (err.message?.includes('no autorizado')) {
            throw error;
        }

        const errorMessages: Record<string, string> = {
            'auth/user-not-found': 'Usuario no encontrado',
            'auth/wrong-password': 'Contraseña incorrecta',
            'auth/invalid-email': 'Email inválido',
            'auth/user-disabled': 'Usuario deshabilitado',
            'auth/too-many-requests': 'Demasiados intentos. Intente más tarde.',
            'auth/invalid-credential': 'Credenciales inválidas'
        };
        throw new Error(err.code ? (errorMessages[err.code] || 'Error de autenticación') : 'Error de autenticación');
    }
};

// ============================================================================
// Sign in with Google
// ============================================================================
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account' // Always show account picker
});

/**
 * Initiates the Google Sign-In popup flow.
 * Checks for authorization in the whitelist after successful Google authentication.
 * 
 * @throws {Error} If the popup is closed, blocked, or if the user is not in the whitelist.
 * @returns The authenticated AuthUser object.
 */
export const signInWithGoogle = async (): Promise<AuthUser> => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        // Check if we're in shared census mode - if so, skip strict whitelist check
        // The shared census mode has its own local authorization via censusAuthorizedEmails.ts
        const isSharedCensusMode = window.location.pathname.startsWith('/censo-compartido') ||
            window.location.pathname.startsWith('/censo-publico');

        if (isSharedCensusMode) {
            // In shared census mode, we allow the login to proceed
            // Authorization is handled by useSharedCensusMode hook using local list
            // console.info('[authService] 🌐 Shared census mode - skipping strict whitelist check');
            return {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: 'viewer_census' // Limited role for census viewers
            };
        }

        // For normal app access, check if email is allowed in Firestore
        const { allowed, role } = await checkEmailInFirestore(user.email || '');
        if (!allowed) {
            await firebaseSignOut(auth);
            throw new Error('Acceso no autorizado. Su correo no está en la lista de usuarios permitidos.');
        }

        return {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role
        };
    } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        // Re-throw our custom error
        if (err.message?.includes('no autorizado')) {
            throw error;
        }

        console.error('Google sign-in failed', error);

        const errorMessages: Record<string, string> = {
            'auth/popup-closed-by-user': 'Inicio de sesión cancelado',
            'auth/popup-blocked': 'El navegador bloqueó la ventana emergente. Permita pop-ups para este sitio.',
            'auth/cancelled-popup-request': 'Operación cancelada',
            'auth/network-request-failed': 'Error de conexión. Verifique su internet.',
            'auth/unauthorized-domain':
                'Dominio no autorizado en Firebase Auth. Agrega el dominio actual en Firebase > Authentication > Settings > Authorized domains.',
            'auth/invalid-api-key':
                'Clave de API inválida. Revisa las variables de entorno de Firebase configuradas en Netlify.'
        };

        throw new Error(err.code ? (errorMessages[err.code] || 'Error al iniciar sesión con Google') : 'Error al iniciar sesión con Google');
    }
};

// ============================================================================
// Create new user (for admin to create staff accounts)
// ============================================================================
/**
 * Creates a new Firebase user with email and password.
 * Note: This only creates the Firebase Auth entry, it does not add the user to the whitelist.
 * 
 * @param email - New user's email.
 * @param password - New user's password.
 * @returns The created AuthUser object.
 */
export const createUser = async (email: string, password: string): Promise<AuthUser> => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL
        };
    } catch (error: unknown) {
        const err = error as { code?: string };
        const errorMessages: Record<string, string> = {
            'auth/email-already-in-use': 'Este email ya está registrado',
            'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
            'auth/invalid-email': 'Email inválido'
        };
        throw new Error(err.code ? (errorMessages[err.code] || 'Error al crear usuario') : 'Error al crear usuario');
    }
};

// ============================================================================
// Sign out
// ============================================================================
/**
 * Signs out the current user from Firebase.
 */
export const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth);
};

// ============================================================================
// Auth State Observer
// ============================================================================
/**
 * Sets up a listener for authentication state changes.
 * Handles normal users, anonymous users (for signatures), and whitelist re-verification.
 * 
 * @param callback - Function to be called with the updated AuthUser or null.
 * @returns An unsubscribe function to stop listening.
 */
export const onAuthChange = (callback: (user: AuthUser | null) => void): (() => void) => {
    // console.debug('[authService] 🎧 Setting up onAuthStateChanged observer');
    return onAuthStateChanged(auth, async (firebaseUser: User | null) => {
        // console.debug('[authService] 👤 Firebase onAuthStateChanged triggered. User:', firebaseUser ? firebaseUser.email || 'Anonymous' : 'NULL');
        if (firebaseUser) {
            // Check if anonymous (used for signature links)
            if (firebaseUser.isAnonymous) {
                callback({
                    uid: firebaseUser.uid,
                    email: null,
                    displayName: 'Anonymous Doctor',
                    role: 'viewer'
                });
                return;
            }

            // Check if we're in shared census mode - skip strict whitelist verification
            const isSharedCensusMode = window.location.pathname.startsWith('/censo-compartido') ||
                window.location.pathname.startsWith('/censo-publico');

            if (isSharedCensusMode) {
                // In shared census mode, allow user through without Firestore check
                // Authorization is handled locally by useSharedCensusMode
                // console.info('[authService] 🌐 Shared census mode - allowing user without Firestore whitelist check');
                callback({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    displayName: firebaseUser.displayName,
                    photoURL: firebaseUser.photoURL,
                    role: 'viewer_census'
                });
                return;
            }

            // Check if still allowed (in case user was removed from whitelist)
            const { allowed, role } = await checkEmailInFirestore(firebaseUser.email || '');
            if (!allowed) {
                // User no longer authorized, sign them out
                await firebaseSignOut(auth);
                callback(null);
                return;
            }

            callback({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                role
            });
        } else {
            callback(null);
        }
    });
};

// ============================================================================
// Get Current User
// ============================================================================
export const getCurrentUser = (): AuthUser | null => {
    const user = auth.currentUser;
    if (!user) return null;
    return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
    };
};

// ============================================================================
// Utility: Check if current user is allowed (async)
// ============================================================================
export const isCurrentUserAllowed = async (): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;
    const { allowed } = await checkEmailInFirestore(user.email || '');
    return allowed;
};

// ============================================================================
// Anonymous Auth for Passport Users (Hybrid Mode)
// ============================================================================
/**
 * Sign in anonymously to Firebase for passport users.
 * This allows passport users to write to Firestore when online.
 * The role/permissions come from the passport, not Firebase.
 * 
 * @returns The Firebase user UID if successful, null if failed
 */
/**
 * Signs in anonymously for users accessing via a passport file.
 * This is used in 'Hybrid Mode' (Offline + Online) to allow writing to Firestore.
 * 
 * @returns The Firebase User UID or null if failed.
 */
export const signInAnonymouslyForPassport = async (): Promise<string | null> => {
    try {
        // Check if already signed in
        if (auth.currentUser) {
            // console.debug('[Auth] Already signed in, uid:', auth.currentUser.uid);
            return auth.currentUser.uid;
        }

        // Create a timeout promise to avoid blocking forever if offline
        const timeoutPromise = new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('Auth timeout')), 2500);
        });

        const authPromise = signInAnonymously(auth);

        const result = await Promise.race([authPromise, timeoutPromise]) as { user: User } | null;

        if (result && result.user) {
            // console.debug('[Auth] Signed in anonymously for passport user, uid:', result.user.uid);
            return result.user.uid;
        }
        return null;
    } catch (error) {
        console.warn('[Auth] Anonymous sign-in skipped or failed (likely offline):', error);
        return null;
    }
};

/**
 * Check if there's an active Firebase auth session (including anonymous).
 */
export const hasActiveFirebaseSession = (): boolean => {
    return auth.currentUser !== null;
};
