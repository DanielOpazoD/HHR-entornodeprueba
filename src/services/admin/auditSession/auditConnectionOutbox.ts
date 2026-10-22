import type { AuditLogEntry } from '@/types/auditLogTypes';
import { AUDIT_SCHEMA_VERSION } from '@/services/admin/auditSession/auditConnectionEntries';

/**
 * Connection events wait here until Firestore confirms them. Each event has its own key (this
 * prefix plus its id), so tabs adding and removing events never overwrite each other's copy of a
 * shared list. The keys survive logout cleanup, reloads and the bootstrap shell, so a "Cierre de
 * sesión" written while signing out is delivered on the next authenticated start.
 */
export const AUDIT_CONNECTION_OUTBOX_PREFIX = 'hhr_audit_connection_outbox_v1:';
/**
 * Room for weeks of drops on a device left offline. A full queue never loses an event: it refuses
 * the new one, which the caller then writes straight away.
 */
const MAX_PENDING = 500;

export type AuditConnectionOutboxStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

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
/** Same instant: a connection starts, drops, then ends. */
const ACTION_ORDER: Record<ConnectionAction, number> = {
  USER_LOGIN: 0,
  CONNECTION_INTERRUPTED: 1,
  USER_LOGOUT: 2,
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

const toOutboxItem = (value: unknown, id: string): AuditConnectionOutboxItem | null => {
  const entry = isRecord(value) ? toAuditConnectionEntry(value.entry) : null;
  if (!entry || entry.id !== id || !isRecord(value)) return null;
  return {
    entry,
    ...(isCount(value.sentAt) ? { sentAt: value.sentAt } : {}),
    ...(isCount(value.rejections) ? { rejections: value.rejections } : {}),
  };
};

const parse = (raw: string | null): unknown => {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

const outboxKeys = (storage: AuditConnectionOutboxStorage): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(AUDIT_CONNECTION_OUTBOX_PREFIX)) keys.push(key);
  }
  return keys;
};

const readItem = (
  storage: AuditConnectionOutboxStorage,
  id: string
): AuditConnectionOutboxItem | null =>
  toOutboxItem(parse(storage.getItem(AUDIT_CONNECTION_OUTBOX_PREFIX + id)), id);

const writeItem = (storage: AuditConnectionOutboxStorage, item: AuditConnectionOutboxItem) => {
  try {
    storage.setItem(AUDIT_CONNECTION_OUTBOX_PREFIX + item.entry.id, JSON.stringify(item));
    return true;
  } catch {
    return false;
  }
};

const removeKey = (storage: AuditConnectionOutboxStorage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // A key that cannot be removed is read again and refused or delivered once more.
  }
};

/** Pending events, oldest first. Anything that is not exactly a connection event is skipped. */
export const readAuditConnectionOutbox = (
  storage: AuditConnectionOutboxStorage
): AuditConnectionOutboxItem[] => {
  try {
    return outboxKeys(storage)
      .flatMap(key => {
        const item = readItem(storage, key.slice(AUDIT_CONNECTION_OUTBOX_PREFIX.length));
        return item ? [item] : [];
      })
      .sort(
        (a, b) =>
          a.entry.timestamp.localeCompare(b.entry.timestamp) ||
          ACTION_ORDER[a.entry.action as ConnectionAction] -
            ACTION_ORDER[b.entry.action as ConnectionAction] ||
          a.entry.id.localeCompare(b.entry.id)
      );
  } catch {
    return [];
  }
};

/**
 * Returns false when the device could not keep the event (storage blocked or full). Past the limit
 * a new event is refused so the caller writes it straight away; `beyondLimit` keeps it anyway, for
 * an event nobody signed in here may write (another person's, kept for their next session).
 */
export const enqueueAuditConnectionEntry = (
  storage: AuditConnectionOutboxStorage,
  entry: AuditLogEntry,
  options: { beyondLimit?: boolean } = {}
): boolean => {
  try {
    // Planted or malformed keys are not events: they go. Queued events are never dropped.
    const keys = outboxKeys(storage).filter(key => {
      if (readItem(storage, key.slice(AUDIT_CONNECTION_OUTBOX_PREFIX.length))) return true;
      removeKey(storage, key);
      return false;
    });
    const queued = keys.includes(AUDIT_CONNECTION_OUTBOX_PREFIX + entry.id);
    if (!queued && keys.length >= MAX_PENDING && !options.beyondLimit) return false;
  } catch {
    // Unreadable storage: try to keep the event anyway.
  }
  return writeItem(storage, { entry });
};

export const markAuditConnectionEntrySent = (
  storage: AuditConnectionOutboxStorage,
  id: string,
  now: number
): void => {
  const item = readItem(storage, id);
  if (item) writeItem(storage, { ...item, sentAt: now });
};

/** Stored or duplicate leave the outbox; a refusal or failure keeps the event for later. */
export const settleAuditConnectionEntry = (
  storage: AuditConnectionOutboxStorage,
  id: string,
  delivery: AuditConnectionDelivery
): void => {
  if (delivery === 'stored' || delivery === 'duplicate') {
    removeKey(storage, AUDIT_CONNECTION_OUTBOX_PREFIX + id);
    return;
  }
  const item = readItem(storage, id);
  if (!item) return;
  const { sentAt: _sentAt, ...rest } = item;
  writeItem(
    storage,
    delivery === 'rejected' ? { ...rest, rejections: (item.rejections ?? 0) + 1 } : rest
  );
};
