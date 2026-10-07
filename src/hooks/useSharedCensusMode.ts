import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { CensusAccessUser } from '@/types/censusAccess';
import {
  buildAuthorizedSharedAccessUser,
  resolveSharedCensusPathInfo,
} from '@/shared/access/sharedCensusAccess';

export interface SharedCensusModeResult {
  isSharedCensusMode: boolean;
  invitationId: string | null;
  accessUser: CensusAccessUser | null;
  isLoading: boolean;
  error: string | null;
  needsLogin: boolean;
}

const SHARED_CENSUS_ALLOWED_AUTH_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'viewer',
  'editor',
]);

/**
 * Hook to manage shared census access.
 *
 * This is a SEPARATE authentication layer from the main app login.
 * Users access via /censo-compartido, login with Google,
 * and their email is validated against the shared-census allowlist.
 *
 * Security is enforced by Firebase Auth + Firestore rules.
 */
export function useSharedCensusMode(): SharedCensusModeResult {
  const { currentUser, role, isLoading: authLoading } = useAuth();
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

    if (!currentUser?.uid) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: null,
        needsLogin: true,
      };
    }

    // User is logged in - validate session role for shared census access.
    const email = currentUser.email;

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

    const isAuthorized = SHARED_CENSUS_ALLOWED_AUTH_ROLES.has(role);

    if (!isAuthorized) {
      return {
        isSharedCensusMode: true,
        invitationId,
        accessUser: null,
        isLoading: false,
        error: `El correo ${email} no está autorizado para ver el censo compartido.`,
        needsLogin: false,
      };
    }

    const authorizedUser: CensusAccessUser = buildAuthorizedSharedAccessUser({
      uid: currentUser.uid,
      email,
      displayName: currentUser.displayName,
    });

    return {
      isSharedCensusMode: true,
      invitationId,
      accessUser: authorizedUser,
      isLoading: false,
      error: null,
      needsLogin: false,
    };
  }, [isSharedCensusMode, invitationId, authLoading, role, currentUser]);
}
