import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type { EpisodeContext } from '@/features/wound-care/use-cases/woundCareUseCases';
import {
  buildInFlightCreateKey,
  buildWoundCareAuditActor,
  executeWoundCareMobileUploadLifecycle,
  filterScopeSessions,
  resolveMobileUploadOutcomeError,
  revokeWoundCareMobileUploadSessionsSequentially,
} from '@/features/wound-care/controllers/woundCareMobileUploadSessionController';
import {
  authoringSessionScope,
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/session/authoringSession';
import { onSessionChange } from '@/services/session/sessionStorageTransition';
import type { WoundCareMobileUploadSession } from '@/types/domain/woundCare';

type MobileQrSessionStatus = 'idle' | 'active' | 'revoked' | 'error' | 'session_ended';
type MobileQrBusyAction = 'idle' | 'creating' | 'revoking';

export const buildWoundCareMobileUploadUrl = (
  sessionId: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : ''
): string => `${origin}/wound-care/mobile-upload/${encodeURIComponent(sessionId)}`;

export const useWoundCareMobileUploadSession = (episodeContext: EpisodeContext) => {
  const { currentUser, role } = useAuth();
  const { episodeKey, patientRut, patientName } = episodeContext;
  const actorUid = currentUser?.uid ?? null;
  const scopeKey = `${episodeKey}::${patientRut}::${actorUid ?? ''}`;

  const [sessionState, setSessionState] = useState<{
    scopeKey: string;
    session: WoundCareMobileUploadSession | null;
    status: MobileQrSessionStatus;
    error: string | null;
  }>({ scopeKey, session: null, status: 'idle', error: null });
  const [busyState, setBusyState] = useState<{ scopeKey: string; action: MobileQrBusyAction }>({
    scopeKey,
    action: 'idle',
  });

  const isMountedRef = useRef(true);
  const previousScopeKeyRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);
  const inFlightActionRef = useRef<MobileQrBusyAction>('idle');
  const inFlightScopeKeyRef = useRef<string | null>(null);
  const activeSessionsRef = useRef<WoundCareMobileUploadSession[]>([]);

  const scopedState =
    sessionState.scopeKey === scopeKey
      ? sessionState
      : { scopeKey, session: null, status: 'idle' as MobileQrSessionStatus, error: null };
  const { session, status, error } = scopedState;
  const busyAction: MobileQrBusyAction =
    busyState.scopeKey === scopeKey ? busyState.action : 'idle';
  const isBusy = busyAction !== 'idle';

  const latestRef = useRef({ currentUser, role, patientName });
  useEffect(() => {
    latestRef.current = { currentUser, role, patientName };
  }, [currentUser, role, patientName]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hideOnSessionLoss = useCallback((targetScopeKey: string) => {
    activeSessionsRef.current = [];
    if (isMountedRef.current) {
      setBusyState({ scopeKey: targetScopeKey, action: 'idle' });
      setSessionState({
        scopeKey: targetScopeKey,
        session: null,
        status: 'session_ended',
        error: null,
      });
    }
  }, []);

  useEffect(() => {
    if (previousScopeKeyRef.current !== scopeKey) {
      previousScopeKeyRef.current = scopeKey;
      requestGenerationRef.current += 1;
      inFlightActionRef.current = 'idle';
      inFlightScopeKeyRef.current = null;
      activeSessionsRef.current = [];
    }
  }, [scopeKey]);

  useEffect(() => {
    const scopeGuard = guardAuthoringSession();
    const checkSessionContinuity = () => {
      if (!scopeGuard.isCurrent()) {
        requestGenerationRef.current += 1;
        inFlightActionRef.current = 'idle';
        inFlightScopeKeyRef.current = null;
        hideOnSessionLoss(scopeKey);
      }
    };

    const unsubscribe = onSessionChange(checkSessionContinuity);
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', checkSessionContinuity);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', checkSessionContinuity);
      }
    };
  }, [hideOnSessionLoss, scopeKey]);

  const checkOperationContinuity = useCallback(
    (
      generation: number,
      authoringSession: AuthoringSessionGuard,
      expectedActorUid: string,
      targetScopeKey: string
    ): boolean => {
      if (!authoringSession.isCurrent()) {
        if (requestGenerationRef.current === generation) {
          hideOnSessionLoss(targetScopeKey);
        }
        return false;
      }
      return (
        isMountedRef.current &&
        requestGenerationRef.current === generation &&
        latestRef.current.currentUser?.uid === expectedActorUid
      );
    },
    [hideOnSessionLoss]
  );

  const uploadUrl = useMemo(
    () => (session ? buildWoundCareMobileUploadUrl(session.sessionId) : null),
    [session]
  );

  const publishPreservedError = useCallback(
    (
      targetScopeKey: string,
      preservedSession: WoundCareMobileUploadSession | null,
      message: string
    ) => {
      setSessionState({
        scopeKey: targetScopeKey,
        session: preservedSession,
        status: preservedSession ? 'active' : 'error',
        error: message,
      });
    },
    []
  );

  const publishCreatedOutcome = useCallback(
    (
      targetScopeKey: string,
      outcome: {
        status: string;
        data: WoundCareMobileUploadSession | null;
        issues: ReadonlyArray<{ userSafeMessage?: string; message?: string }>;
      }
    ): WoundCareMobileUploadSession | null => {
      if (outcome.status !== 'success' || !outcome.data) {
        activeSessionsRef.current = [];
        publishPreservedError(
          targetScopeKey,
          null,
          resolveMobileUploadOutcomeError(outcome.issues, 'No fue posible generar el QR.')
        );
        return null;
      }
      activeSessionsRef.current = [outcome.data];
      setSessionState({
        scopeKey: targetScopeKey,
        session: outcome.data,
        status: 'active',
        error: null,
      });
      return outcome.data;
    },
    [publishPreservedError]
  );

  const releaseBusyState = useCallback((generation: number, targetScopeKey: string) => {
    if (requestGenerationRef.current === generation) {
      inFlightActionRef.current = 'idle';
      inFlightScopeKeyRef.current = null;
      if (isMountedRef.current) {
        setBusyState({ scopeKey: targetScopeKey, action: 'idle' });
      }
    }
  }, []);

  const runSessionLifecycle = useCallback(
    async (mode: 'initialize' | 'regenerate') => {
      const activeUser = latestRef.current.currentUser;
      if (!activeUser || !actorUid) {
        requestGenerationRef.current += 1;
        inFlightActionRef.current = 'idle';
        inFlightScopeKeyRef.current = null;
        activeSessionsRef.current = [];
        if (isMountedRef.current) {
          setBusyState({ scopeKey, action: 'idle' });
          publishPreservedError(scopeKey, null, 'Debe iniciar sesión para generar el QR.');
        }
        return null;
      }

      const authoringSession = guardAuthoringSession();
      if (!authoringSession.isCurrent()) {
        hideOnSessionLoss(scopeKey);
        return null;
      }
      if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
        return null;
      }

      const expectedActorUid = activeUser.uid;
      const actor = buildWoundCareAuditActor(activeUser, latestRef.current.role);
      const hospitalId = getActiveHospitalId();
      const generation = ++requestGenerationRef.current;
      const isStillCurrent = () =>
        checkOperationContinuity(generation, authoringSession, expectedActorUid, scopeKey);

      inFlightActionRef.current = 'creating';
      inFlightScopeKeyRef.current = scopeKey;
      setBusyState({ scopeKey, action: 'creating' });
      setSessionState(previous => ({
        scopeKey,
        session: previous.scopeKey === scopeKey ? previous.session : null,
        status: previous.scopeKey === scopeKey ? previous.status : 'idle',
        error: null,
      }));

      try {
        const outcome = await executeWoundCareMobileUploadLifecycle({
          mode,
          inFlightKey: buildInFlightCreateKey(
            authoringSessionScope(authoringSession.session),
            expectedActorUid,
            hospitalId,
            episodeKey
          ),
          episodeContext: { episodeKey, patientRut, patientName: latestRef.current.patientName },
          actor,
          hospitalId,
          rememberedSessions: activeSessionsRef.current,
          isStillCurrent,
          onActiveSessionsChange: sessions => {
            activeSessionsRef.current = sessions;
          },
          onPreviousRevoked: () => {
            setSessionState({ scopeKey, session: null, status: 'revoked', error: null });
          },
        });

        if (outcome.status === 'aborted') return null;
        if (outcome.status === 'reused') {
          setSessionState({
            scopeKey,
            session: outcome.session,
            status: outcome.session ? 'active' : 'idle',
            error: null,
          });
          return outcome.session;
        }
        if (outcome.status === 'error') {
          publishPreservedError(scopeKey, outcome.preservedSession, outcome.message);
          return null;
        }
        return publishCreatedOutcome(scopeKey, outcome.outcome);
      } catch (unknownError) {
        if (!isStillCurrent()) return null;
        const preservedSession =
          filterScopeSessions(activeSessionsRef.current, episodeKey, patientRut)[0] ?? null;
        publishPreservedError(
          scopeKey,
          preservedSession,
          unknownError instanceof Error ? unknownError.message : 'No fue posible generar el QR.'
        );
        return null;
      } finally {
        releaseBusyState(generation, scopeKey);
      }
    },
    [
      actorUid,
      checkOperationContinuity,
      episodeKey,
      hideOnSessionLoss,
      patientRut,
      publishCreatedOutcome,
      publishPreservedError,
      releaseBusyState,
      scopeKey,
    ]
  );

  const initializeSession = useCallback(
    () => runSessionLifecycle('initialize'),
    [runSessionLifecycle]
  );
  const createSession = useCallback(() => runSessionLifecycle('regenerate'), [runSessionLifecycle]);

  const revokeSession = useCallback(async () => {
    const sessionsToRevoke = filterScopeSessions(activeSessionsRef.current, episodeKey, patientRut);
    const primarySession = sessionsToRevoke[0] ?? null;
    if (!primarySession) return false;

    const activeUser = latestRef.current.currentUser;
    if (!activeUser) {
      if (isMountedRef.current) {
        publishPreservedError(scopeKey, primarySession, 'Debe iniciar sesión para revocar el QR.');
      }
      return false;
    }

    const authoringSession = guardAuthoringSession();
    if (!authoringSession.isCurrent()) {
      hideOnSessionLoss(scopeKey);
      return false;
    }
    if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
      return false;
    }

    const expectedActorUid = activeUser.uid;
    const actor = buildWoundCareAuditActor(activeUser, latestRef.current.role);
    const hospitalId = getActiveHospitalId();
    const generation = ++requestGenerationRef.current;
    const isStillCurrent = () =>
      checkOperationContinuity(generation, authoringSession, expectedActorUid, scopeKey);

    inFlightActionRef.current = 'revoking';
    inFlightScopeKeyRef.current = scopeKey;
    setBusyState({ scopeKey, action: 'revoking' });
    setSessionState({ scopeKey, session: primarySession, status: 'active', error: null });

    try {
      const revokeOutcome = await revokeWoundCareMobileUploadSessionsSequentially({
        sessions: sessionsToRevoke,
        actor,
        hospitalId,
        fallbackError: 'No fue posible revocar el QR.',
        isStillCurrent,
        onRemainingSessionsChange: remaining => {
          activeSessionsRef.current = remaining;
        },
      });
      if (revokeOutcome.status === 'aborted') return false;
      if (revokeOutcome.status === 'failed') {
        publishPreservedError(
          scopeKey,
          revokeOutcome.remainingSessions[0] ?? null,
          revokeOutcome.message
        );
        return false;
      }
      setSessionState({ scopeKey, session: null, status: 'revoked', error: null });
      return true;
    } catch (unknownError) {
      if (!isStillCurrent()) return false;
      const preservedSession =
        filterScopeSessions(activeSessionsRef.current, episodeKey, patientRut)[0] ?? null;
      publishPreservedError(
        scopeKey,
        preservedSession,
        unknownError instanceof Error ? unknownError.message : 'No fue posible revocar el QR.'
      );
      return false;
    } finally {
      releaseBusyState(generation, scopeKey);
    }
  }, [
    checkOperationContinuity,
    episodeKey,
    hideOnSessionLoss,
    patientRut,
    publishPreservedError,
    releaseBusyState,
    scopeKey,
  ]);

  return {
    session,
    uploadUrl,
    status,
    busyAction,
    isBusy,
    error,
    initializeSession,
    createSession,
    revokeSession,
  };
};
