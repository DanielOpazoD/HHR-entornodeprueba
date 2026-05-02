import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import {
  executeCreateWoundCareMobileUploadSession,
  executeRevokeWoundCareMobileUploadSession,
  type EpisodeContext,
} from '@/application/wound-care/woundCareUseCases';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';

const buildActor = (
  user: { uid: string; email: string | null; displayName: string | null },
  role: string
): WoundCareAuditActor => ({
  uid: user.uid,
  email: user.email || 'sin-email',
  displayName: user.displayName || 'Sin nombre',
  role,
});

export const buildWoundCareMobileUploadUrl = (
  sessionId: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : ''
): string => `${origin}/wound-care/mobile-upload/${encodeURIComponent(sessionId)}`;

export const useWoundCareMobileUploadSession = (episodeContext: EpisodeContext) => {
  const { currentUser, role } = useAuth();
  const [session, setSession] = useState<WoundCareMobileUploadSession | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadUrl = useMemo(
    () => (session ? buildWoundCareMobileUploadUrl(session.sessionId) : null),
    [session]
  );

  const createSession = useCallback(async () => {
    if (!currentUser) {
      setError('Debe iniciar sesión para generar el QR.');
      return null;
    }

    setIsBusy(true);
    setError(null);
    try {
      const result = await executeCreateWoundCareMobileUploadSession({
        episodeContext,
        actor: buildActor(currentUser, role),
        hospitalId: getActiveHospitalId(),
      });

      if (result.status !== 'success' || !result.data) {
        const message = result.issues[0]?.message || 'No fue posible generar el QR.';
        setError(message);
        return null;
      }

      setSession(result.data);
      return result.data;
    } catch (unknownError) {
      const message =
        unknownError instanceof Error ? unknownError.message : 'No fue posible generar el QR.';
      setError(message);
      return null;
    } finally {
      setIsBusy(false);
    }
  }, [currentUser, episodeContext, role]);

  const revokeSession = useCallback(async () => {
    if (!currentUser || !session) return;

    setIsBusy(true);
    setError(null);
    try {
      await executeRevokeWoundCareMobileUploadSession({
        sessionId: session.sessionId,
        actor: buildActor(currentUser, role),
        hospitalId: getActiveHospitalId(),
      });
      setSession(null);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : 'No fue posible revocar el QR.'
      );
    } finally {
      setIsBusy(false);
    }
  }, [currentUser, role, session]);

  return {
    session,
    uploadUrl,
    isBusy,
    error,
    createSession,
    revokeSession,
  };
};
