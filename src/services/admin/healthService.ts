import { firestoreDb } from '@/services/storage/firestore';
import { healthServiceLogger } from '@/services/admin/adminLoggers';
export type {
  SystemHealthIncidentResolution,
  SystemHealthIncidentResolutionActor,
  SystemHealthIncidentResolutionHistoryEntry,
  SystemHealthIncidentResolutionState,
  SystemHealthIncidentResolutionStatus,
  SystemHealthSummary,
  UserHealthEventSeverity,
  UserHealthRecentEvent,
  UserHealthStatus,
  VersionUpdateReason,
} from '@/services/admin/healthService.contracts';
export {
  normalizeSystemHealthIncidentResolution,
  normalizeSystemHealthIncidentResolutionState,
  normalizeUserHealthStatus,
} from '@/services/admin/healthService.normalization';
export { buildSystemHealthSummary } from '@/services/admin/healthService.summary';
import {
  normalizeSystemHealthIncidentResolution,
  normalizeSystemHealthIncidentResolutionState,
  normalizeUserHealthStatus,
} from '@/services/admin/healthService.normalization';
import type {
  SystemHealthIncidentResolution,
  SystemHealthIncidentResolutionActor,
  SystemHealthIncidentResolutionHistoryEntry,
  SystemHealthIncidentResolutionState,
  UserHealthStatus,
} from '@/services/admin/healthService.contracts';

const HEALTH_COLLECTION = 'system_health';
const STATS_DOC = 'stats';
const USERS_SUBCOLLECTION = 'users';
const RESOLUTIONS_SUBCOLLECTION = 'resolutions';

const isHealthPermissionError = (error: unknown): boolean => {
  const authError = error as { code?: string; message?: string };
  const code = String(authError?.code || '').toLowerCase();
  const message = String(authError?.message || '').toLowerCase();
  return code.includes('permission') || message.includes('missing or insufficient permissions');
};

export const reportUserHealth = async (status: UserHealthStatus): Promise<void> => {
  try {
    const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
    await firestoreDb.setDoc(path, status.uid, {
      ...status,
      lastSeen: new Date().toISOString(),
    });
  } catch (error) {
    if (isHealthPermissionError(error)) {
      return;
    }
    healthServiceLogger.error('Failed to report health', error);
  }
};

export const deleteUserHealthSnapshot = async (uid: string): Promise<void> => {
  const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
  await firestoreDb.deleteDoc(path, uid);
};

const getHealthResolutionPath = () =>
  `${STATS_DOC}/${HEALTH_COLLECTION}/${RESOLUTIONS_SUBCOLLECTION}`;

const encodeResolutionDocId = (resolutionKey: string): string => encodeURIComponent(resolutionKey);

const normalizeActor = (actor: SystemHealthIncidentResolutionActor) => ({
  uid: actor.uid || 'unknown',
  email: actor.email || 'unknown@local',
  name: actor.displayName || actor.email || 'Usuario del sistema',
});

const readExistingResolutionHistory = async (
  resolutionKey: string
): Promise<SystemHealthIncidentResolutionHistoryEntry[]> => {
  const existing = await firestoreDb.getDoc<Partial<SystemHealthIncidentResolution>>(
    getHealthResolutionPath(),
    encodeResolutionDocId(resolutionKey)
  );
  return normalizeSystemHealthIncidentResolution(existing)?.history || [];
};

export const resolveSystemHealthIncident = async ({
  resolutionKey,
  resolvedAt,
  actor,
  note,
}: {
  resolutionKey: string;
  resolvedAt: string;
  actor: SystemHealthIncidentResolutionActor;
  note?: string;
}): Promise<void> => {
  const normalizedActor = normalizeActor(actor);
  const history = await readExistingResolutionHistory(resolutionKey);
  const historyEntry: SystemHealthIncidentResolutionHistoryEntry = {
    action: 'resolved',
    at: resolvedAt,
    actorUid: normalizedActor.uid,
    actorEmail: normalizedActor.email,
    actorName: normalizedActor.name,
    note,
  };

  await firestoreDb.setDoc(
    getHealthResolutionPath(),
    encodeResolutionDocId(resolutionKey),
    {
      resolutionKey,
      status: 'resolved',
      updatedAt: resolvedAt,
      resolvedAt,
      resolvedByUid: normalizedActor.uid,
      resolvedByEmail: normalizedActor.email,
      resolvedByName: normalizedActor.name,
      note: note || '',
      history: [...history, historyEntry],
    } satisfies SystemHealthIncidentResolution,
    { merge: true }
  );
};

export const reopenSystemHealthIncident = async ({
  resolutionKey,
  reopenedAt,
  actor,
  note,
}: {
  resolutionKey: string;
  reopenedAt: string;
  actor: SystemHealthIncidentResolutionActor;
  note?: string;
}): Promise<void> => {
  const normalizedActor = normalizeActor(actor);
  const history = await readExistingResolutionHistory(resolutionKey);
  const historyEntry: SystemHealthIncidentResolutionHistoryEntry = {
    action: 'reopened',
    at: reopenedAt,
    actorUid: normalizedActor.uid,
    actorEmail: normalizedActor.email,
    actorName: normalizedActor.name,
    note,
  };

  await firestoreDb.setDoc(
    getHealthResolutionPath(),
    encodeResolutionDocId(resolutionKey),
    {
      resolutionKey,
      status: 'open',
      updatedAt: reopenedAt,
      reopenedAt,
      reopenedByUid: normalizedActor.uid,
      reopenedByEmail: normalizedActor.email,
      reopenedByName: normalizedActor.name,
      note: note || '',
      history: [...history, historyEntry],
    },
    { merge: true }
  );
};

export const subscribeToSystemHealthIncidentResolutions = (
  onUpdate: (data: SystemHealthIncidentResolutionState) => void
) =>
  firestoreDb.subscribeQuery<Partial<SystemHealthIncidentResolution>>(
    getHealthResolutionPath(),
    {
      orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 300,
    },
    resolutions => {
      onUpdate(normalizeSystemHealthIncidentResolutionState(resolutions));
    }
  );

export const subscribeToSystemHealth = (onUpdate: (data: UserHealthStatus[]) => void) => {
  const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
  return firestoreDb.subscribeQuery<Partial<UserHealthStatus>>(
    path,
    {
      orderBy: [{ field: 'lastSeen', direction: 'desc' }],
      limit: 50,
    },
    users => {
      onUpdate(users.map(normalizeUserHealthStatus));
    }
  );
};

export const getSystemHealthSnapshot = async (): Promise<UserHealthStatus[]> => {
  try {
    const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
    const users = await firestoreDb.getDocs<Partial<UserHealthStatus>>(path, {
      orderBy: [{ field: 'lastSeen', direction: 'desc' }],
      limit: 100,
    });
    return users.map(normalizeUserHealthStatus);
  } catch (error) {
    healthServiceLogger.error('Failed to fetch health snapshot', error);
    return [];
  }
};
