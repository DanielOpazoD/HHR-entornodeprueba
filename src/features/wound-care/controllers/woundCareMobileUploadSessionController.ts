import {
  executeCreateWoundCareMobileUploadSession,
  executeListActiveWoundCareMobileUploadSessions,
  executeRevokeWoundCareMobileUploadSession,
  type EpisodeContext,
} from '@/features/wound-care/use-cases/woundCareUseCases';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';

// Deduplicate in-flight QR creations across panel remounts (e.g. closing and reopening
// Curaciones while a session write is still pending) scoped to the active authoring session.
const inFlightCreatesByScope = new Map<
  string,
  Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>>
>();

export const buildWoundCareAuditActor = (
  user: { uid: string; email: string | null; displayName: string | null },
  role: string
): WoundCareAuditActor => ({
  uid: user.uid,
  email: user.email || 'sin-email',
  displayName: user.displayName || 'Sin nombre',
  role,
});

export const filterScopeSessions = (
  sessions: readonly WoundCareMobileUploadSession[],
  episodeKey: string,
  patientRut: string
): WoundCareMobileUploadSession[] =>
  sessions.filter(
    session => session.episodeKey === episodeKey && session.patientRut === patientRut
  );

export const resolveMobileUploadOutcomeError = (
  issues: ReadonlyArray<{ userSafeMessage?: string; message?: string }>,
  fallback: string
): string => issues[0]?.userSafeMessage || issues[0]?.message || fallback;

export const buildInFlightCreateKey = (
  sessionScope: string,
  actorUid: string,
  hospitalId: string,
  episodeKey: string
): string => `${sessionScope}::${actorUid}::${hospitalId}::${episodeKey}`;

export const getPendingWoundCareMobileUploadCreate = (
  inFlightKey: string
): Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>> | undefined =>
  inFlightCreatesByScope.get(inFlightKey);

export const issueWoundCareMobileUploadSession = async (params: {
  inFlightKey: string;
  episodeContext: EpisodeContext;
  actor: WoundCareAuditActor;
  hospitalId: string;
}): Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>> => {
  const { inFlightKey, episodeContext, actor, hospitalId } = params;
  const existingCreate = inFlightCreatesByScope.get(inFlightKey);
  if (existingCreate) {
    return existingCreate;
  }

  const createPromise = executeCreateWoundCareMobileUploadSession({
    episodeContext,
    actor,
    hospitalId,
  }).finally(() => {
    if (inFlightCreatesByScope.get(inFlightKey) === createPromise) {
      inFlightCreatesByScope.delete(inFlightKey);
    }
  });

  inFlightCreatesByScope.set(inFlightKey, createPromise);
  return createPromise;
};

export type SequentialRevokeOutcome =
  | { status: 'revoked' }
  | { status: 'aborted' }
  | {
      status: 'failed';
      message: string;
      remainingSessions: WoundCareMobileUploadSession[];
    };

export const revokeWoundCareMobileUploadSessionsSequentially = async (params: {
  sessions: readonly WoundCareMobileUploadSession[];
  actor: WoundCareAuditActor;
  hospitalId: string;
  fallbackError: string;
  isStillCurrent: () => boolean;
  onRemainingSessionsChange: (remaining: WoundCareMobileUploadSession[]) => void;
}): Promise<SequentialRevokeOutcome> => {
  const { sessions, actor, hospitalId, fallbackError, isStillCurrent, onRemainingSessionsChange } =
    params;
  let remainingSessions = [...sessions];

  for (const targetSession of sessions) {
    if (!isStillCurrent()) {
      return { status: 'aborted' };
    }
    const revokeResult = await executeRevokeWoundCareMobileUploadSession({
      sessionId: targetSession.sessionId,
      actor,
      hospitalId,
    });
    if (!isStillCurrent()) {
      return { status: 'aborted' };
    }
    if (revokeResult.status !== 'success') {
      onRemainingSessionsChange(remainingSessions);
      return {
        status: 'failed',
        message: resolveMobileUploadOutcomeError(revokeResult.issues, fallbackError),
        remainingSessions,
      };
    }
    remainingSessions = remainingSessions.filter(
      item => item.sessionId !== targetSession.sessionId
    );
    onRemainingSessionsChange(remainingSessions);
  }

  return { status: 'revoked' };
};

export type MobileUploadLifecycleResult =
  | { status: 'aborted' }
  | { status: 'reused'; session: WoundCareMobileUploadSession | null }
  | {
      status: 'created';
      outcome: ApplicationOutcome<WoundCareMobileUploadSession | null>;
    }
  | {
      status: 'error';
      preservedSession: WoundCareMobileUploadSession | null;
      message: string;
    };

export const executeWoundCareMobileUploadLifecycle = async (params: {
  mode: 'initialize' | 'regenerate';
  inFlightKey: string;
  episodeContext: EpisodeContext;
  actor: WoundCareAuditActor;
  hospitalId: string;
  rememberedSessions: readonly WoundCareMobileUploadSession[];
  isStillCurrent: () => boolean;
  onActiveSessionsChange: (sessions: WoundCareMobileUploadSession[]) => void;
  onPreviousRevoked: () => void;
}): Promise<MobileUploadLifecycleResult> => {
  const {
    mode,
    inFlightKey,
    episodeContext,
    actor,
    hospitalId,
    rememberedSessions,
    isStillCurrent,
    onActiveSessionsChange,
    onPreviousRevoked,
  } = params;
  const { episodeKey, patientRut } = episodeContext;

  const pendingCreate =
    mode === 'initialize' ? getPendingWoundCareMobileUploadCreate(inFlightKey) : undefined;
  if (pendingCreate) {
    const joinedResult = await pendingCreate;
    return isStillCurrent() ? { status: 'created', outcome: joinedResult } : { status: 'aborted' };
  }

  const listResult = await executeListActiveWoundCareMobileUploadSessions({
    episodeKey,
    hospitalId,
  });
  if (!isStillCurrent()) {
    return { status: 'aborted' };
  }

  if (listResult.status !== 'success') {
    const preserved = filterScopeSessions(rememberedSessions, episodeKey, patientRut)[0] ?? null;
    return {
      status: 'error',
      preservedSession: preserved,
      message: resolveMobileUploadOutcomeError(
        listResult.issues,
        'No fue posible verificar si existe un QR activo.'
      ),
    };
  }

  // Server read is authoritative: do not re-inject locally remembered sessions that
  // another station already revoked.
  const discoveredActive = filterScopeSessions(listResult.data, episodeKey, patientRut);
  onActiveSessionsChange(discoveredActive);

  if (mode === 'initialize' && discoveredActive.length > 0) {
    return { status: 'reused', session: discoveredActive[0] ?? null };
  }

  // Regenerate revokes every active QR for this episode before issuing a replacement so
  // no previous link remains live and unrevocable in Firestore.
  if (discoveredActive.length > 0) {
    const revokeOutcome = await revokeWoundCareMobileUploadSessionsSequentially({
      sessions: discoveredActive,
      actor,
      hospitalId,
      fallbackError: 'No fue posible revocar el QR anterior.',
      isStillCurrent,
      onRemainingSessionsChange: onActiveSessionsChange,
    });
    if (revokeOutcome.status === 'aborted') {
      return { status: 'aborted' };
    }
    if (revokeOutcome.status === 'failed') {
      return {
        status: 'error',
        preservedSession: revokeOutcome.remainingSessions[0] ?? null,
        message: revokeOutcome.message,
      };
    }
    onPreviousRevoked();
  }

  if (!isStillCurrent()) {
    return { status: 'aborted' };
  }

  const outcome = await issueWoundCareMobileUploadSession({
    inFlightKey,
    episodeContext,
    actor,
    hospitalId,
  });
  return isStillCurrent() ? { status: 'created', outcome } : { status: 'aborted' };
};
