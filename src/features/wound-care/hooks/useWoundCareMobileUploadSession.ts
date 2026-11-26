import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import {
  executeCreateWoundCareMobileUploadSession,
  executeRevokeWoundCareMobileUploadSession,
  type EpisodeContext,
} from '@/features/wound-care/use-cases/woundCareUseCases';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';

type MobileQrSessionStatus = 'idle' | 'active' | 'revoked' | 'error';
type MobileQrBusyAction = 'idle' | 'creating' | 'revoking';

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
  const { episodeKey, patientRut, patientName } = episodeContext;
  const actorUid = currentUser?.uid ?? null;
  const scopeKey = `${episodeKey}::${patientRut}`;

  const [sessionState, setSessionState] = useState<{
    scopeKey: string;
    session: WoundCareMobileUploadSession | null;
    status: MobileQrSessionStatus;
    error: string | null;
  }>({
    scopeKey,
    session: null,
    status: 'idle',
    error: null,
  });
  const [busyState, setBusyState] = useState<{
    scopeKey: string;
    action: MobileQrBusyAction;
  }>({
    scopeKey,
    action: 'idle',
  });

  const isMountedRef = useRef(true);
  const previousScopeKeyRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);
  const inFlightActionRef = useRef<MobileQrBusyAction>('idle');
  const inFlightScopeKeyRef = useRef<string | null>(null);
  const activeSessionRef = useRef<WoundCareMobileUploadSession | null>(null);

  const scopedState =
    sessionState.scopeKey === scopeKey
      ? sessionState
      : { scopeKey, session: null, status: 'idle' as MobileQrSessionStatus, error: null };
  const session = scopedState.session;
  const status = scopedState.status;
  const error = scopedState.error;
  const busyAction: MobileQrBusyAction =
    busyState.scopeKey === scopeKey ? busyState.action : 'idle';
  const isBusy = busyAction !== 'idle';

  const latestRef = useRef({
    currentUser,
    role,
    patientName,
  });
  useEffect(() => {
    latestRef.current = {
      currentUser,
      role,
      patientName,
    };
  }, [currentUser, role, patientName]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previousScopeKeyRef.current !== scopeKey) {
      previousScopeKeyRef.current = scopeKey;
      requestGenerationRef.current += 1;
      inFlightActionRef.current = 'idle';
      inFlightScopeKeyRef.current = null;
      activeSessionRef.current = null;
    }
  }, [scopeKey]);

  const uploadUrl = useMemo(
    () => (session ? buildWoundCareMobileUploadUrl(session.sessionId) : null),
    [session]
  );

  const createSession = useCallback(async () => {
    const activeUser = latestRef.current.currentUser;
    if (!activeUser || !actorUid) {
      requestGenerationRef.current += 1;
      inFlightActionRef.current = 'idle';
      inFlightScopeKeyRef.current = null;
      activeSessionRef.current = null;
      if (isMountedRef.current) {
        setBusyState({ scopeKey, action: 'idle' });
        setSessionState({
          scopeKey,
          session: null,
          status: 'error',
          error: 'Debe iniciar sesión para generar el QR.',
        });
      }
      return null;
    }

    if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
      return null;
    }

    const generation = ++requestGenerationRef.current;
    inFlightActionRef.current = 'creating';
    inFlightScopeKeyRef.current = scopeKey;
    setBusyState({ scopeKey, action: 'creating' });
    setSessionState(previous => ({
      scopeKey,
      session: previous.scopeKey === scopeKey ? previous.session : null,
      status: previous.scopeKey === scopeKey ? previous.status : 'idle',
      error: null,
    }));

    const actor = buildActor(activeUser, latestRef.current.role);
    const hospitalId = getActiveHospitalId();
    const activeSessionForScope =
      activeSessionRef.current &&
      activeSessionRef.current.episodeKey === episodeKey &&
      activeSessionRef.current.patientRut === patientRut
        ? activeSessionRef.current
        : null;

    try {
      // Revoke the previous active QR for this episode before issuing a replacement so no
      // unrevocable live link is orphaned in Firestore when regenerating.
      if (activeSessionForScope) {
        const revokeResult = await executeRevokeWoundCareMobileUploadSession({
          sessionId: activeSessionForScope.sessionId,
          actor,
          hospitalId,
        });

        if (!isMountedRef.current || requestGenerationRef.current !== generation) {
          return null;
        }

        if (revokeResult.status !== 'success') {
          const message =
            revokeResult.issues[0]?.userSafeMessage ||
            revokeResult.issues[0]?.message ||
            'No fue posible revocar el QR anterior.';
          setSessionState({
            scopeKey,
            session: activeSessionForScope,
            status: 'active',
            error: message,
          });
          return null;
        }

        activeSessionRef.current = null;
        setSessionState({
          scopeKey,
          session: null,
          status: 'revoked',
          error: null,
        });
      }

      const result = await executeCreateWoundCareMobileUploadSession({
        episodeContext: {
          episodeKey,
          patientRut,
          patientName: latestRef.current.patientName,
        },
        actor,
        hospitalId,
      });

      if (!isMountedRef.current || requestGenerationRef.current !== generation) {
        return null;
      }

      if (result.status !== 'success' || !result.data) {
        const message =
          result.issues[0]?.userSafeMessage ||
          result.issues[0]?.message ||
          'No fue posible generar el QR.';
        activeSessionRef.current = null;
        setSessionState({
          scopeKey,
          session: null,
          status: 'error',
          error: message,
        });
        return null;
      }

      activeSessionRef.current = result.data;
      setSessionState({
        scopeKey,
        session: result.data,
        status: 'active',
        error: null,
      });
      return result.data;
    } catch (unknownError) {
      if (!isMountedRef.current || requestGenerationRef.current !== generation) {
        return null;
      }
      const message =
        unknownError instanceof Error ? unknownError.message : 'No fue posible generar el QR.';
      const preservedSession =
        activeSessionRef.current &&
        activeSessionRef.current.episodeKey === episodeKey &&
        activeSessionRef.current.patientRut === patientRut
          ? activeSessionRef.current
          : null;
      setSessionState({
        scopeKey,
        session: preservedSession,
        status: preservedSession ? 'active' : 'error',
        error: message,
      });
      return null;
    } finally {
      if (requestGenerationRef.current === generation) {
        inFlightActionRef.current = 'idle';
        inFlightScopeKeyRef.current = null;
        if (isMountedRef.current) {
          setBusyState({ scopeKey, action: 'idle' });
        }
      }
    }
  }, [actorUid, episodeKey, patientRut, scopeKey]);

  const revokeSession = useCallback(async () => {
    const activeSession = activeSessionRef.current;
    if (
      !activeSession ||
      activeSession.episodeKey !== episodeKey ||
      activeSession.patientRut !== patientRut
    ) {
      return false;
    }

    const activeUser = latestRef.current.currentUser;
    if (!activeUser) {
      if (isMountedRef.current) {
        setSessionState({
          scopeKey,
          session: activeSession,
          status: 'active',
          error: 'Debe iniciar sesión para revocar el QR.',
        });
      }
      return false;
    }

    if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
      return false;
    }

    const generation = ++requestGenerationRef.current;
    inFlightActionRef.current = 'revoking';
    inFlightScopeKeyRef.current = scopeKey;
    setBusyState({ scopeKey, action: 'revoking' });
    setSessionState({
      scopeKey,
      session: activeSession,
      status: 'active',
      error: null,
    });

    try {
      const result = await executeRevokeWoundCareMobileUploadSession({
        sessionId: activeSession.sessionId,
        actor: buildActor(activeUser, latestRef.current.role),
        hospitalId: getActiveHospitalId(),
      });

      if (!isMountedRef.current || requestGenerationRef.current !== generation) {
        return false;
      }

      if (result.status !== 'success') {
        const message =
          result.issues[0]?.userSafeMessage ||
          result.issues[0]?.message ||
          'No fue posible revocar el QR.';
        setSessionState({
          scopeKey,
          session: activeSession,
          status: 'active',
          error: message,
        });
        return false;
      }

      activeSessionRef.current = null;
      setSessionState({
        scopeKey,
        session: null,
        status: 'revoked',
        error: null,
      });
      return true;
    } catch (unknownError) {
      if (!isMountedRef.current || requestGenerationRef.current !== generation) {
        return false;
      }
      setSessionState({
        scopeKey,
        session: activeSession,
        status: 'active',
        error:
          unknownError instanceof Error ? unknownError.message : 'No fue posible revocar el QR.',
      });
      return false;
    } finally {
      if (requestGenerationRef.current === generation) {
        inFlightActionRef.current = 'idle';
        inFlightScopeKeyRef.current = null;
        if (isMountedRef.current) {
          setBusyState({ scopeKey, action: 'idle' });
        }
      }
    }
  }, [episodeKey, patientRut, scopeKey]);

  return {
    session,
    uploadUrl,
    status,
    busyAction,
    isBusy,
    error,
    createSession,
    revokeSession,
  };
};
