import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isEmailAuthorizedForCensus } from '../constants/censusAuthorizedEmails';
import { CensusAccessUser } from '../types/censusAccess';

export interface SharedCensusModeResult {
    isSharedCensusMode: boolean;
    invitationId: string | null;
    accessUser: CensusAccessUser | null;
    isLoading: boolean;
    error: string | null;
    needsLogin: boolean;
}

/**
 * Hook to manage shared census access.
 * 
 * This is a SEPARATE authentication layer from the main app login.
 * Users access via /censo-compartido, login with Google,
 * and their email is checked against a local authorized list.
 * 
 * NO Firestore permissions required - validation is done locally.
 */
export function useSharedCensusMode(): SharedCensusModeResult {
    const { user, isLoading: authLoading } = useAuth();
    const pathname = window.location.pathname;

    // Detection: Are we in shared census mode?
    const isSharedCensusMode = pathname.startsWith('/censo-compartido') || pathname.startsWith('/censo-publico');

    // Get invitation ID from URL (optional, for tracking)
    const invitationId = pathname.split('/').pop() || null;

    const [accessUser, setAccessUser] = useState<CensusAccessUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [needsLogin, setNeedsLogin] = useState(false);

    useEffect(() => {
        if (!isSharedCensusMode) {
            setIsLoading(false);
            return;
        }

        // Wait for auth to complete
        if (authLoading) return;

        // If no user is logged in, they need to login
        if (!user?.uid) {
            setNeedsLogin(true);
            setIsLoading(false);
            return;
        }

        // User is logged in - check if their email is authorized
        const email = user.email;

        if (!email) {
            setError('Tu cuenta de Google no tiene un correo asociado.');
            setIsLoading(false);
            return;
        }

        // Check authorization against local list (NO Firestore needed!)
        const isAuthorized = isEmailAuthorizedForCensus(email);

        if (!isAuthorized) {
            setError(`El correo ${email} no está autorizado para ver el censo. Contacta al administrador.`);
            setIsLoading(false);
            return;
        }

        // Authorized! Create access user object
        const authorizedUser: CensusAccessUser = {
            id: user.uid,
            email: email.toLowerCase(),
            displayName: user.displayName || email.split('@')[0],
            role: 'viewer', // Everyone in shared mode is a viewer
            createdAt: new Date(),
            createdBy: 'local-auth',
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
            isActive: true
        };

        setAccessUser(authorizedUser);
        setNeedsLogin(false);
        setError(null);
        setIsLoading(false);

    }, [isSharedCensusMode, user, authLoading]);

    return {
        isSharedCensusMode,
        invitationId,
        accessUser,
        isLoading: isLoading || authLoading,
        error,
        needsLogin
    };
}
