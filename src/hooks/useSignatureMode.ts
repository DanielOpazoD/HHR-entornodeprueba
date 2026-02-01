/**
 * useSignatureMode
 * Handles URL-based signature mode for medical handoffs
 */
import { useEffect, useMemo, useRef } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '@/firebaseConfig';
import { AuthUser } from '@/services/auth/authService';

interface SignatureModeResult {
    isSignatureMode: boolean;
    signatureDate: string | null;
    currentDateString: string;
}

export function useSignatureMode(
    navDateString: string,
    user: AuthUser | null,
    authLoading: boolean
): SignatureModeResult {
    // Parse URL params
    const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
    const isSignatureMode = urlParams.get('mode') === 'signature';
    const signatureDate = urlParams.get('date');

    // Anonymous login for signature mode
    const isSigningInRef = useRef(false);
    useEffect(() => {
        // ONLY sign in anonymously if we are in signature mode AND have NO user whatsoever (real or passport)
        if (isSignatureMode && !user && !authLoading && !isSigningInRef.current) {
            isSigningInRef.current = true;
            // console.debug("[useSignatureMode] 👤 No user found in signature mode, signing in anonymously...");
            signInAnonymously(auth).catch((err) => {
                console.error("Anonymous auth failed", err);
                isSigningInRef.current = false;
            });
        }
    }, [isSignatureMode, user, authLoading]);

    // Determine effective date
    const currentDateString = useMemo(() => {
        if (isSignatureMode && signatureDate) {
            // Support DD-MM-YYYY format
            if (signatureDate.includes('-') && signatureDate.split('-')[0].length <= 2) {
                const [d, m, y] = signatureDate.split('-');
                return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
            return signatureDate;
        }
        return navDateString;
    }, [isSignatureMode, signatureDate, navDateString]);

    return {
        isSignatureMode,
        signatureDate,
        currentDateString
    };
}
