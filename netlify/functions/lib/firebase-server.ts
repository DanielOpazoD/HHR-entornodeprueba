import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

const decodeBase64 = (value: string) => {
    if (!value) return '';
    try {
        const normalized = String(value)
            .trim()
            .replace(/\s+/g, '')
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(value.length / 4) * 4, '=');

        return Buffer.from(normalized, 'base64').toString('utf-8');
    } catch (error) {
        console.warn('Unable to decode base64 Firebase key', error);
        return '';
    }
};

const buildConfig = () => {
    const base64Key = process.env.VITE_FIREBASE_API_KEY_B64;
    const plainKey = process.env.VITE_FIREBASE_API_KEY;
    const apiKey = base64Key ? decodeBase64(base64Key) : plainKey || '';

    return {
        apiKey,
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.VITE_FIREBASE_APP_ID || ''
    };
};

let app: FirebaseApp;
let db: Firestore;

export const getFirebaseServer = () => {
    if (getApps().length === 0) {
        const config = buildConfig();
        if (!config.apiKey) {
            throw new Error('Missing Firebase configuration. Ensure environment variables are set.');
        }
        app = initializeApp(config);
        db = getFirestore(app);
    } else {
        app = getApp();
        db = getFirestore(app);
    }
    return { app, db };
};
