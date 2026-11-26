import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import {
  executeCreateWoundCareMobileUploadSession,
  executeListActiveWoundCareMobileUploadSessions,
  executeRevokeWoundCareMobileUploadSession,
  type EpisodeContext,
} from '@/features/wound-care/use-cases/woundCareUseCases';
import {
  authoringSessionScope,
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/session/authoringSession';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';

type MobileQrSessionStatus = 'idle' | 'active' | 'revoked' | 'error';
type MobileQrBusyAction = 'idle' | 'creating' | 'revoking';

// Deduplicate in-flight QR creations across panel remounts (e.g. closing and reopening
// Curaciones while a session write is still pending) scoped to the active authoring session.
const inFlightCreatesByScope = new Map<
  string,
  Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>>
>();

const buildActor = (
  user: { uid: string; email: string | null; displayName: string | null },
  role: string
): WoundCareAuditActor => ({
  uid: user.uid,
  email: user.email || 'sin-email',
  displayName: user.displayName || 'Sin nombre',
  role,
});

const mergeSessionsById = (
  primary: readonly WoundCareMobileUploadSession[],
  secondary: readonly WoundCareMobileUploadSession[]
): WoundCareMobileUploadSession[] => {
  const byId = new Map<string, WoundCareMobileUploadSession>();
  for (const session of [...primary, ...secondary]) {
    if (!byId.has(session.sessionId)) {
      byId.set(session.sessionId, session);
    }
  }
  return Array.from(byId.values()).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
};

const filterScopeSessions = (
  sessions: readonly WoundCareMobileUploadSession[],
  episodeKey: string,
  patientRut: string
): WoundCareMobileUploadSession[] =>
  sessions.filter(
    session => session.episodeKey === episodeKey && session.patientRut === patientRut
  );

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
  const activeSessionsRef = useRef<WoundCareMobileUploadSession[]>([]);

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
      activeSessionsRef.current = [];
    }
  }, [scopeKey]);

  const isOperationCurrent = useCallback(
    (
      generation: number,
      authoringSession: AuthoringSessionGuard,
      expectedActorUid: string
    ): boolean =>
      isMountedRef.current &&
      requestGenerationRef.current === generation &&
      latestRef.current.currentUser?.uid === expectedActorUid &&
      authoringSession.isCurrent(),
    []
  );

  const uploadUrl = useMemo(
    () => (session ? buildWoundCareMobileUploadUrl(session.sessionId) : null),
    [session]
  );

  const issueNewSession = useCallback(
    async (
      hospitalId: string,
      actor: WoundCareAuditActor,
      authoringSession: AuthoringSessionGuard
    ): Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>> => {
      const inFlightKey = `${authoringSessionScope(authoringSession.session)}::${actor.uid}::${hospitalId}::${episodeKey}`;
      const existingCreate = inFlightCreatesByScope.get(inFlightKey);
      if (existingCreate) {
        return existingCreate;
      }

      const createPromise = executeCreateWoundCareMobileUploadSession({
        episodeContext: {
          episodeKey,
          patientRut,
          patientName: latestRef.current.patientName,
        },
        actor,
        hospitalId,
      }).finally(() => {
        if (inFlightCreatesByScope.get(inFlightKey) === createPromise) {
          inFlightCreatesByScope.delete(inFlightKey);
        }
      });

      inFlightCreatesByScope.set(inFlightKey, createPromise);
      return createPromise;
    },
    [episodeKey, patientRut]
  );

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
          setSessionState({
            scopeKey,
            session: null,
            status: 'error',
            error: 'Debe iniciar sesión para generar el QR.',
          });
        }
        return null;
      }

      const authoringSession = guardAuthoringSession();
      if (!authoringSession.isCurrent()) {
        return null;
      }

      if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
        return null;
      }

      const expectedActorUid = activeUser.uid;
      const actor = buildActor(activeUser, latestRef.current.role);
      const hospitalId = getActiveHospitalId();
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

      try {
        const inFlightKey = `${authoringSessionScope(authoringSession.session)}::${expectedActorUid}::${hospitalId}::${episodeKey}`;
        const pendingCreate =
          mode === 'initialize' ? inFlightCreatesByScope.get(inFlightKey) : undefined;
        if (pendingCreate) {
          const joinedResult = await pendingCreate;
          if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
            return null;
          }
          if (joinedResult.status !== 'success' || !joinedResult.data) {
            const message =
              joinedResult.issues[0]?.userSafeMessage ||
              joinedResult.issues[0]?.message ||
              'No fue posible generar el QR.';
            activeSessionsRef.current = [];
            setSessionState({
              scopeKey,
              session: null,
              status: 'error',
              error: message,
            });
            return null;
          }
          activeSessionsRef.current = [joinedResult.data];
          setSessionState({
            scopeKey,
            session: joinedResult.data,
            status: 'active',
            error: null,
          });
          return joinedResult.data;
        }

        const listResult = await executeListActiveWoundCareMobileUploadSessions({
          episodeKey,
          hospitalId,
        });
        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return null;
        }

        const rememberedForScope = filterScopeSessions(
          activeSessionsRef.current,
          episodeKey,
          patientRut
        );

        if (listResult.status !== 'success') {
          const message =
            listResult.issues[0]?.userSafeMessage ||
            listResult.issues[0]?.message ||
            'No fue posible verificar si existe un QR activo.';
          const preserved = rememberedForScope[0] ?? null;
          setSessionState({
            scopeKey,
            session: preserved,
            status: preserved ? 'active' : 'error',
            error: message,
          });
          return null;
        }

        const discoveredActive = mergeSessionsById(
          filterScopeSessions(listResult.data, episodeKey, patientRut),
          rememberedForScope
        );

        if (mode === 'initialize' && discoveredActive.length > 0) {
          const primarySession = discoveredActive[0] ?? null;
          activeSessionsRef.current = discoveredActive;
          setSessionState({
            scopeKey,
            session: primarySession,
            status: primarySession ? 'active' : 'idle',
            error: null,
          });
          return primarySession;
        }

        // Regenerate revokes every active QR for this episode before issuing a replacement so
        // no previous link remains live and unrevocable in Firestore.
        if (discoveredActive.length > 0) {
          let remainingSessions = [...discoveredActive];
          for (const previousSession of discoveredActive) {
            if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
              return null;
            }
            const revokeResult = await executeRevokeWoundCareMobileUploadSession({
              sessionId: previousSession.sessionId,
              actor,
              hospitalId,
            });
            if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
              return null;
            }
            if (revokeResult.status !== 'success') {
              const message =
                revokeResult.issues[0]?.userSafeMessage ||
                revokeResult.issues[0]?.message ||
                'No fue posible revocar el QR anterior.';
              activeSessionsRef.current = remainingSessions;
              setSessionState({
                scopeKey,
                session: remainingSessions[0] ?? null,
                status: remainingSessions.length > 0 ? 'active' : 'error',
                error: message,
              });
              return null;
            }
            remainingSessions = remainingSessions.filter(
              item => item.sessionId !== previousSession.sessionId
            );
            activeSessionsRef.current = remainingSessions;
          }

          setSessionState({
            scopeKey,
            session: null,
            status: 'revoked',
            error: null,
          });
        }

        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return null;
        }

        const result = await issueNewSession(hospitalId, actor, authoringSession);
        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return null;
        }

        if (result.status !== 'success' || !result.data) {
          const message =
            result.issues[0]?.userSafeMessage ||
            result.issues[0]?.message ||
            'No fue posible generar el QR.';
          activeSessionsRef.current = [];
          setSessionState({
            scopeKey,
            session: null,
            status: 'error',
            error: message,
          });
          return null;
        }

        activeSessionsRef.current = [result.data];
        setSessionState({
          scopeKey,
          session: result.data,
          status: 'active',
          error: null,
        });
        return result.data;
      } catch (unknownError) {
        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return null;
        }
        const message =
          unknownError instanceof Error ? unknownError.message : 'No fue posible generar el QR.';
        const preservedSessions = filterScopeSessions(
          activeSessionsRef.current,
          episodeKey,
          patientRut
        );
        const preservedSession = preservedSessions[0] ?? null;
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
    },
    [actorUid, episodeKey, isOperationCurrent, issueNewSession, patientRut, scopeKey]
  );

  const initializeSession = useCallback(
    () => runSessionLifecycle('initialize'),
    [runSessionLifecycle]
  );

  const createSession = useCallback(() => runSessionLifecycle('regenerate'), [runSessionLifecycle]);

  const revokeSession = useCallback(async () => {
    const sessionsToRevoke = filterScopeSessions(activeSessionsRef.current, episodeKey, patientRut);
    const primarySession = sessionsToRevoke[0] ?? null;
    if (!primarySession) {
      return false;
    }

    const activeUser = latestRef.current.currentUser;
    if (!activeUser) {
      if (isMountedRef.current) {
        setSessionState({
          scopeKey,
          session: primarySession,
          status: 'active',
          error: 'Debe iniciar sesión para revocar el QR.',
        });
      }
      return false;
    }

    const authoringSession = guardAuthoringSession();
    if (!authoringSession.isCurrent()) {
      return false;
    }

    if (inFlightActionRef.current !== 'idle' && inFlightScopeKeyRef.current === scopeKey) {
      return false;
    }

    const expectedActorUid = activeUser.uid;
    const actor = buildActor(activeUser, latestRef.current.role);
    const hospitalId = getActiveHospitalId();
    const generation = ++requestGenerationRef.current;

    inFlightActionRef.current = 'revoking';
    inFlightScopeKeyRef.current = scopeKey;
    setBusyState({ scopeKey, action: 'revoking' });
    setSessionState({
      scopeKey,
      session: primarySession,
      status: 'active',
      error: null,
    });

    try {
      let remainingSessions = [...sessionsToRevoke];
      for (const targetSession of sessionsToRevoke) {
        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return false;
        }
        const result = await executeRevokeWoundCareMobileUploadSession({
          sessionId: targetSession.sessionId,
          actor,
          hospitalId,
        });
        if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
          return false;
        }

        if (result.status !== 'success') {
          const message =
            result.issues[0]?.userSafeMessage ||
            result.issues[0]?.message ||
            'No fue posible revocar el QR.';
          activeSessionsRef.current = remainingSessions;
          setSessionState({
            scopeKey,
            session: remainingSessions[0] ?? null,
            status: remainingSessions.length > 0 ? 'active' : 'error',
            error: message,
          });
          return false;
        }

        remainingSessions = remainingSessions.filter(
          item => item.sessionId !== targetSession.sessionId
        );
        activeSessionsRef.current = remainingSessions;
      }

      setSessionState({
        scopeKey,
        session: null,
        status: 'revoked',
        error: null,
      });
      return true;
    } catch (unknownError) {
      if (!isOperationCurrent(generation, authoringSession, expectedActorUid)) {
        return false;
      }
      const preservedSessions = filterScopeSessions(
        activeSessionsRef.current,
        episodeKey,
        patientRut
      );
      setSessionState({
        scopeKey,
        session: preservedSessions[0] ?? null,
        status: preservedSessions.length > 0 ? 'active' : 'error',
        error:
          unknownError instanceof Error ? unknownError.message : 'No fue posible revocar el QR.',
      });
      return false;
    } finally {
      if (requestGenerationRef.current === generation) {
        inFlightActionRef.current = 'idle';
        inFlightScopeKeyRef.current = null;
        if (isMountedRef.current && authoringSession.isCurrent()) {
          setBusyState({ scopeKey, action: 'idle' });
        }
      }
    }
  }, [episodeKey, isOperationCurrent, patientRut, scopeKey]);

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
