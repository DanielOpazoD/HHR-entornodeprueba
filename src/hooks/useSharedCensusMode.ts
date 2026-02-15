import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isEmailAuthorizedForCensus } from '@/constants/censusAuthorizedEmails';
import { CensusAccessUser } from '@/types/censusAccess';
import {
  buildAuthorizedSharedAccessUser,
  resolveSharedCensusPathInfo,
} from '@/features/census/controllers/sharedCensusModeController';

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
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const { isSharedCensusMode, invitationId } = resolveSharedCensusPathInfo(pathname);

  return useMemo<SharedCensusModeResult>(() => {
    if (!isSharedCensusMode) {
      return {
        isSharedCensusMode: false,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: null,
        needsLogin: false,
      };
    }

    if (authLoading) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: true,
        error: null,
        needsLogin: false,
      };
    }

    if (!user?.uid) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: null,
        needsLogin: true,
      };
    }

    // User is logged in - check if their email is authorized
    const email = user.email;

    if (!email) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: 'Tu cuenta de Google no tiene un correo asociado.',
        needsLogin: false,
      };
    }

    const isAuthorized = isEmailAuthorizedForCensus(email);

    if (!isAuthorized) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: `El correo ${email} no está autorizado para ver el censo. Contacta al administrador.`,
        needsLogin: false,
      };
    }

    const authorizedUser: CensusAccessUser = buildAuthorizedSharedAccessUser({
      uid: user.uid,
      email,
      displayName: user.displayName,
    });

    return {
      isSharedCensusMode: true,
      invitationId,
      accessUser: authorizedUser,
      isLoading: false,
      error: null,
      needsLogin: false,
    };
  }, [isSharedCensusMode, invitationId, authLoading, user]);
}
