import type { AuditLogEntry } from '@/types/auditLogTypes';
import { AUDIT_SCHEMA_VERSION } from '@/services/admin/auditSession/auditConnectionEntries';

/**
 * Connection events wait here until Firestore confirms them. The key survives logout cleanup,
 * reloads and the bootstrap shell, so a "Cierre de sesión" written while signing out (when the
 * write could reach the server unauthenticated) is delivered on the next authenticated start.
 */
export const AUDIT_CONNECTION_OUTBOX_KEY = 'hhr_audit_connection_outbox_v1';
const MAX_PENDING = 20;

export interface AuditConnectionOutboxItem {
  entry: AuditLogEntry;
  /** Set while a write is on its way. Still set when read again: that write may have landed. */
  sentAt?: number;
  /** Explicit refusals so far (e.g. the signed-in account may not write the audit). */
  rejections?: number;
}

export type AuditConnectionDelivery = 'stored' | 'duplicate' | 'rejected' | 'failed';

type ConnectionAction = 'USER_LOGIN' | 'USER_LOGOUT' | 'CONNECTION_INTERRUPTED';

const SESSION_ID = /^[\w-]{1,64}$/;
const ID_SUFFIX: Record<ConnectionAction, RegExp> = {
  USER_LOGIN: /^start$/,
  USER_LOGOUT: /^end$/,
  CONNECTION_INTERRUPTED: /^net_\d{1,14}$/,
};
const STARTS = new Set(['sign_in', 'resume']);
const END_REASONS = new Set(['manual', 'automatic', 'closed']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, maxLength = 256): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined;

const isoTime = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isConnectionAction = (value: unknown): value is ConnectionAction =>
  typeof value === 'string' && value in ID_SUFFIX;

const rebuildDetails = (
  action: ConnectionAction,
  details: Record<string, unknown>,
  sessionId: string
): Record<string, unknown> | null => {
  if (details.sessionId !== sessionId) return null;
  if (action === 'USER_LOGIN') {
    return typeof details.start === 'string' && STARTS.has(details.start)
      ? { sessionId, start: details.start }
      : null;
  }
  const durationSeconds = isCount(details.durationSeconds) ? details.durationSeconds : undefined;
  if (action === 'USER_LOGOUT') {
    const startedAt = isoTime(details.startedAt);
    const endedAt = isoTime(details.endedAt);
    return typeof details.reason === 'string' &&
      END_REASONS.has(details.reason) &&
      startedAt &&
      endedAt &&
      durationSeconds !== undefined
      ? { sessionId, reason: details.reason, startedAt, endedAt, durationSeconds }
      : null;
  }
  const offlineFrom = isoTime(details.offlineFrom);
  const offlineTo = isoTime(details.offlineTo);
  return offlineFrom && offlineTo && durationSeconds !== undefined
    ? { sessionId, offlineFrom, offlineTo, durationSeconds }
    : null;
};

/**
 * The connection event a stored value stands for, rebuilt from the fields the tracker writes.
 * Anyone at the device can edit localStorage before the next person signs in, so anything that
 * is not exactly a connection event is refused rather than written under that person's session.
 */
export const toAuditConnectionEntry = (value: unknown): AuditLogEntry | null => {
  if (!isRecord(value) || !isConnectionAction(value.action) || !isRecord(value.details)) {
    return null;
  }
  const action = value.action;
  const sessionId =
    typeof value.sessionId === 'string' && SESSION_ID.test(value.sessionId)
      ? value.sessionId
      : undefined;
  const id = text(value.id);
  const prefix = `conn_${sessionId}_`;
  if (!sessionId || !id?.startsWith(prefix) || !ID_SUFFIX[action].test(id.slice(prefix.length))) {
    return null;
  }

  const userId = text(value.userId);
  const userUid = text(value.userUid, 128);
  const timestamp = isoTime(value.timestamp);
  const details = rebuildDetails(action, value.details, sessionId);
  if (!userId || !userUid || !timestamp || !details || value.entityId !== userId) return null;

  const optional = {
    userDisplayName: text(value.userDisplayName, 200),
    ipAddress: text(value.ipAddress, 64),
    device: text(value.device, 120),
  };
  return {
    id,
    schemaVersion: AUDIT_SCHEMA_VERSION,
    userId,
    userUid,
    ...Object.fromEntries(Object.entries(optional).filter(([, field]) => field !== undefined)),
    entityType: 'user',
    entityId: userId,
    sessionId,
    timestamp,
    action,
    details,
  };
};

export const readAuditConnectionOutbox = (
  storage: Pick<Storage, 'getItem'>
): AuditConnectionOutboxItem[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(AUDIT_CONNECTION_OUTBOX_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown): AuditConnectionOutboxItem[] => {
      const entry = isRecord(item) ? toAuditConnectionEntry(item.entry) : null;
      if (!entry || !isRecord(item)) return [];
      return [
        {
          entry,
          ...(isCount(item.sentAt) ? { sentAt: item.sentAt } : {}),
          ...(isCount(item.rejections) ? { rejections: item.rejections } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
};

const writeOutbox = (
  storage: Pick<Storage, 'setItem'>,
  items: AuditConnectionOutboxItem[]
): boolean => {
  try {
    storage.setItem(AUDIT_CONNECTION_OUTBOX_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

/** Returns false when the device could not keep the event (storage blocked or full). */
export const enqueueAuditConnectionEntry = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  entry: AuditLogEntry
): boolean => {
  const pending = readAuditConnectionOutbox(storage).filter(item => item.entry.id !== entry.id);
  return writeOutbox(storage, [...pending, { entry }].slice(-MAX_PENDING));
};

const update = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  id: string,
  change: (item: AuditConnectionOutboxItem) => AuditConnectionOutboxItem | null
): void => {
  writeOutbox(
    storage,
    readAuditConnectionOutbox(storage).flatMap(item => {
      if (item.entry.id !== id) return [item];
      const next = change(item);
      return next ? [next] : [];
    })
  );
};

export const markAuditConnectionEntrySent = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  id: string,
  now: number
): void => update(storage, id, item => ({ ...item, sentAt: now }));

/** Stored or duplicate leave the outbox; a refusal or failure keeps the event for later. */
export const settleAuditConnectionEntry = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  id: string,
  delivery: AuditConnectionDelivery
): void =>
  update(storage, id, item => {
    if (delivery === 'stored' || delivery === 'duplicate') return null;
    const { sentAt: _sentAt, ...rest } = item;
    return delivery === 'rejected' ? { ...rest, rejections: (item.rejections ?? 0) + 1 } : rest;
  });
