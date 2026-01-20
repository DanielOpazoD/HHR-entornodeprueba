import { initializeApp, type FirebaseOptions, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, type Auth } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';

const CACHED_CONFIG_KEY = 'hhr_firebase_config';

const decodeBase64 = (rawValue: string) => {
    const value = rawValue?.trim();
    if (!value) return '';

    const normalized = value
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=');

    try {
        if (typeof atob === 'function') {
            return atob(normalized);
        }

        return Buffer.from(normalized, 'base64').toString('utf-8');
    } catch (error) {
        console.warn('Firebase API key could not be decoded from base64:', error);
        return '';
    }
};

const mountConfigWarning = (message: string) => {
    console.warn(message);

    if (typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root) return;

    root.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;">
            <div style="max-width:520px;padding:24px;border-radius:12px;background:white;box-shadow:0 10px 40px rgba(15,23,42,0.12);font-family:Inter,sans-serif;">
                <h1 style="font-size:20px;font-weight:700;margin:0 0 12px 0;">Configuración de Firebase incompleta</h1>
                <p style="margin:0 0 8px 0;line-height:1.5;">La aplicación no puede iniciarse porque falta la clave API de Firebase.</p>
                <ol style="margin:0 0 12px 20px;line-height:1.5;">
                    <li>En Netlify, crea la variable <code>VITE_FIREBASE_API_KEY</code> (o <code>VITE_FIREBASE_API_KEY_B64</code> si prefieres base64) con tu API key de Firebase.</li>
                    <li>Vuelve a desplegar el sitio para que la configuración se aplique.</li>
                </ol>
                <p style="margin:0;color:#475569;font-size:14px;">Las claves se cargan en tiempo de ejecución desde una función serverless, por lo que no se incluyen en el bundle público.</p>
            </div>
        </div>
    `;
};

const saveCachedConfig = (config: FirebaseOptions) => {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(CACHED_CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
        console.warn('[FirebaseConfig] Failed to cache Firebase config:', error);
    }
};

const getCachedConfig = (): FirebaseOptions | null => {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(CACHED_CONFIG_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as FirebaseOptions;
        return parsed.apiKey ? parsed : null;
    } catch (error) {
        console.warn('[FirebaseConfig] Failed to read cached Firebase config:', error);
        return null;
    }
};

const fetchRuntimeConfig = async (): Promise<FirebaseOptions> => {
    const configUrl = `/.netlify/functions/firebase-config?t=${Date.now()}&mode=recovery`;
    const response = await fetch(configUrl, {
        headers: { 'Cache-Control': 'no-cache' }
    });

    if (!response.ok) {
        throw new Error(`Runtime config request failed (${response.status})`);
    }

    const config = await response.json();
    return config satisfies FirebaseOptions;
};

const buildDevConfig = (): FirebaseOptions => {
    const encodedKey = import.meta.env.VITE_FIREBASE_API_KEY_B64 || '';
    const plainKey = import.meta.env.VITE_FIREBASE_API_KEY || '';
    const apiKey = encodedKey ? decodeBase64(encodedKey) : plainKey;

    return {
        apiKey,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID
    } satisfies FirebaseOptions;
};

const loadFirebaseConfig = async () => {
    if (import.meta.env.DEV) {
        return buildDevConfig();
    }

    const cached = getCachedConfig();

    try {
        const config = await fetchRuntimeConfig();
        saveCachedConfig(config);
        return config;
    } catch (error) {
        if (cached?.apiKey) {
            console.warn('[FirebaseConfig] Using cached Firebase config due to network error');
            return cached;
        }

        console.error('Failed to load Firebase config from Netlify function', error);
        mountConfigWarning('No se pudo cargar la configuración de Firebase desde Netlify. Verifica las variables en el panel de Netlify.');
        throw error;
    }
};

let app!: FirebaseApp;
let auth!: Auth;
let db!: Firestore;
let storage!: FirebaseStorage;
let functions!: Functions;

export const firebaseReady = (async () => {
    // eslint-disable-next-line no-console
    console.log('[FirebaseConfig] 🚀 Starting Firebase Ready sequence...');

    // Safety timeout for the entire initialization
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase initialization timed out')), 10000));

    try {
        const configPromise = (async () => {
            const config = await loadFirebaseConfig();
            // eslint-disable-next-line no-console
            console.log('[FirebaseConfig] 📁 Config loaded:', config.projectId);
            // eslint-disable-next-line no-console
            console.log('[FirebaseConfig] 🪣 Storage Bucket:', config.storageBucket || 'not set');

            if (!config.apiKey) {
                mountConfigWarning('Firebase API key is missing. Please configure it in Netlify.');
                throw new Error('Missing Firebase API key');
            }

            app = initializeApp(config);
            auth = getAuth(app);
            db = initializeFirestore(app, { ignoreUndefinedProperties: true });
            storage = getStorage(app);
            functions = getFunctions(app);

            setPersistence(auth, browserLocalPersistence).catch(err => {
                console.warn('[FirebaseConfig] Failed to set auth persistence:', err);
            });

            // eslint-disable-next-line no-console
            console.log('[FirebaseConfig] 🔥 Firebase initialized');

            const authEmulatorHost = import.meta.env.VITE_AUTH_EMULATOR_HOST;
            const firestoreEmulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;

            if (import.meta.env.DEV && authEmulatorHost) {
                connectAuthEmulator(auth, authEmulatorHost);
            }

            if (import.meta.env.DEV && firestoreEmulatorHost) {
                const [host, port] = firestoreEmulatorHost.split(':');
                connectFirestoreEmulator(db, host, Number(port));
            }

            if (import.meta.env.DEV) {
                const functionsEmulatorHost = import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST || 'localhost:5001';
                const [host, port] = functionsEmulatorHost.split(':');
                connectFunctionsEmulator(functions, host, Number(port));
            }

            return { app, auth, db, storage, functions };
        })();

        return await Promise.race([configPromise, timeout]);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[FirebaseConfig] ❌ Critical initialization error:', message);
        // We throw here because without Firebase the app can't function properly
        // but it will be caught by anyone awaiting firebaseReady
        throw err;
    }
})();

export { app, auth, db, storage, functions, mountConfigWarning };
export default app;
