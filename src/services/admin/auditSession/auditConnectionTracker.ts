/**
 * Connection sessions for the audit trail.
 *
 * One connection per device: every tab of the same user shares a record in localStorage, so a
 * new tab or a reload does not open a second "Inicio de sesión". The record keeps a local
 * heartbeat (no network writes); when the device comes back after the last tab was closed, the
 * previous connection is closed retroactively at its last heartbeat ("Desconexión"). Events use
 * deterministic ids: the audit collection is create-only, so a duplicate from another tab is
 * rejected instead of stored twice.
 */

export interface AuditConnectionIdentity {
  uid: string;
  email: string;
  name?: string;
  /** Where the connection was opened; its events keep it even when written later. */
  ipAddress?: string;
  device?: string;
}

export type AuditConnectionEndReason = 'manual' | 'automatic' | 'closed';

export interface AuditConnectionRecord extends AuditConnectionIdentity {
  id: string;
  startedAt: number;
  lastSeenAt: number;
  endedAt?: number;
  offlineSince?: number;
  /** Set when the end was recorded locally but its event could not be emitted yet. */
  pendingEnd?: AuditConnectionEndReason;
}

export type AuditConnectionEvent =
  | { kind: 'start'; record: AuditConnectionRecord; start: 'sign_in' | 'resume' }
  | {
      kind: 'end';
      record: AuditConnectionRecord;
      reason: AuditConnectionEndReason;
      endedAt: number;
    }
  | { kind: 'interruption'; record: AuditConnectionRecord; from: number; to: number };

export interface AuditConnectionDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  createId: () => string;
  emit: (event: AuditConnectionEvent) => void;
  /** Serializes starts across tabs (Web Locks); runs inline when unavailable. */
  withLock: <T>(task: () => T) => Promise<T>;
}

export const AUDIT_CONNECTION_STORAGE_KEY = 'hhr_audit_connection_v1';
export const AUDIT_CONNECTION_HEARTBEAT_MS = 60_000;
/** A device silent for longer than this was closed or asleep: the connection ended. */
export const AUDIT_CONNECTION_RESUME_GAP_MS = 15 * 60_000;
/** Shorter network drops are noise. */
export const AUDIT_CONNECTION_MIN_OFFLINE_MS = 60_000;
/** Reopening after longer than this reads as a new start, not a "Reconexión". */
export const AUDIT_CONNECTION_RESUME_LABEL_WINDOW_MS = 12 * 60 * 60_000;
/** Edits flushed while signing out still belong to the connection that just ended. */
const ENDED_CONNECTION_STAMP_GRACE_MS = 10_000;

export const readAuditConnection = (
  storage: Pick<Storage, 'getItem'>
): AuditConnectionRecord | null => {
  try {
    const raw = storage.getItem(AUDIT_CONNECTION_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AuditConnectionRecord>) : null;
    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      typeof parsed.uid !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.lastSeenAt !== 'number'
    ) {
      return null;
    }
    return parsed as AuditConnectionRecord;
  } catch {
    return null;
  }
};

const writeRecord = (
  storage: Pick<Storage, 'setItem'>,
  record: AuditConnectionRecord
): AuditConnectionRecord => {
  try {
    storage.setItem(AUDIT_CONNECTION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the connection still works; it just cannot be shared across tabs.
  }
  return record;
};

const isLive = (
  record: AuditConnectionRecord | null,
  uid: string
): record is AuditConnectionRecord => Boolean(record && record.uid === uid && !record.endedAt);

const closePrevious = (
  previous: AuditConnectionRecord | null,
  deps: AuditConnectionDependencies
): void => {
  if (!previous) return;
  if (!previous.endedAt) {
    deps.emit({ kind: 'end', record: previous, reason: 'closed', endedAt: previous.lastSeenAt });
  } else if (previous.pendingEnd) {
    deps.emit({
      kind: 'end',
      record: previous,
      reason: previous.pendingEnd,
      endedAt: previous.endedAt,
    });
  }
};

const startConnection = (
  identity: AuditConnectionIdentity,
  previous: AuditConnectionRecord | null,
  deps: AuditConnectionDependencies
): AuditConnectionRecord => {
  closePrevious(previous, deps);
  const now = deps.now();
  const record = writeRecord(deps.storage, {
    ...identity,
    id: deps.createId(),
    startedAt: now,
    lastSeenAt: now,
  });
  // After a recorded logout the next start is a sign-in, even for the same person.
  const resumed = Boolean(
    previous &&
    previous.uid === identity.uid &&
    !previous.endedAt &&
    now - previous.lastSeenAt <= AUDIT_CONNECTION_RESUME_LABEL_WINDOW_MS
  );
  deps.emit({ kind: 'start', record, start: resumed ? 'resume' : 'sign_in' });
  return record;
};

/**
 * Joins the device connection of this user, or opens one. Returns the connection id. A tab that
 * starts online clears an offline mark left by a page closed without network.
 */
export const beginAuditConnection = (
  identity: AuditConnectionIdentity,
  deps: AuditConnectionDependencies,
  online = true
): Promise<string> =>
  deps.withLock(() => {
    const record = readAuditConnection(deps.storage);
    const now = deps.now();
    if (isLive(record, identity.uid) && now - record.lastSeenAt <= AUDIT_CONNECTION_RESUME_GAP_MS) {
      const { offlineSince, ...rest } = record;
      const joined = {
        ...rest,
        uid: identity.uid,
        email: identity.email,
        name: identity.name ?? record.name,
        lastSeenAt: now,
        ...(online || offlineSince === undefined ? {} : { offlineSince }),
      };
      return writeRecord(deps.storage, joined).id;
    }
    return startConnection(identity, record, deps).id;
  });

/** Heartbeat from any open tab; a long silence (sleep, closed laptop) splits the connection. */
export const touchAuditConnection = (
  identity: AuditConnectionIdentity,
  deps: AuditConnectionDependencies
): Promise<void> =>
  deps.withLock(() => {
    const record = readAuditConnection(deps.storage);
    if (!isLive(record, identity.uid)) return;
    const now = deps.now();
    if (now - record.lastSeenAt > AUDIT_CONNECTION_RESUME_GAP_MS) {
      startConnection(identity, record, deps);
      return;
    }
    writeRecord(deps.storage, { ...record, lastSeenAt: now });
  });

/**
 * Closes the connection once, whichever tab gets here first. Synchronous, so the end is
 * recorded before sign-out starts. Without `uid` it closes whichever connection is open on this
 * device.
 */
export const endAuditConnection = (
  uid: string | undefined,
  reason: AuditConnectionEndReason,
  deps: AuditConnectionDependencies
): void => {
  const record = readAuditConnection(deps.storage);
  if (!isLive(record, uid ?? record?.uid ?? '')) return;
  const now = deps.now();
  // A connection silent past the resume gap already ended when its window closed (e.g. the
  // inactivity logout firing as a stale browser reopens): keep that time, not this one.
  const stale = now - record.lastSeenAt > AUDIT_CONNECTION_RESUME_GAP_MS;
  const endedAt = stale ? record.lastSeenAt : now;
  const ended = writeRecord(deps.storage, { ...record, lastSeenAt: endedAt, endedAt });
  deps.emit({ kind: 'end', record: ended, reason: stale ? 'closed' : reason, endedAt });
};

/**
 * Bootstrap-shell logout: Firebase is not ready to write, so the end is only recorded on the
 * device; the next start on this device emits it with the original time and reason.
 */
export const recordAuditConnectionEndLocally = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  reason: AuditConnectionEndReason,
  now: number
): void => {
  const record = readAuditConnection(storage);
  if (!record || record.endedAt) return;
  writeRecord(storage, { ...record, lastSeenAt: now, endedAt: now, pendingEnd: reason });
};

export const markAuditConnectionOffline = (
  uid: string,
  deps: AuditConnectionDependencies
): void => {
  const record = readAuditConnection(deps.storage);
  if (!isLive(record, uid) || record.offlineSince) return;
  writeRecord(deps.storage, { ...record, offlineSince: deps.now() });
};

export const markAuditConnectionOnline = (uid: string, deps: AuditConnectionDependencies): void => {
  const record = readAuditConnection(deps.storage);
  if (!isLive(record, uid) || !record.offlineSince) return;
  const from = record.offlineSince;
  const to = deps.now();
  const { offlineSince: _cleared, ...rest } = record;
  const updated = writeRecord(deps.storage, { ...rest, lastSeenAt: to });
  if (to - from >= AUDIT_CONNECTION_MIN_OFFLINE_MS) {
    deps.emit({ kind: 'interruption', record: updated, from, to });
  }
};

/** Id stamped on every audit event of this user while the connection is open. */
export const resolveAuditConnectionId = (
  storage: Pick<Storage, 'getItem'>,
  uid: string | undefined,
  now: number = Date.now()
): string | undefined => {
  if (!uid) return undefined;
  const record = readAuditConnection(storage);
  if (!record || record.uid !== uid) return undefined;
  if (!record.endedAt || now - record.endedAt <= ENDED_CONNECTION_STAMP_GRACE_MS) return record.id;
  return undefined;
};

export const buildAuditConnectionEventId = (event: AuditConnectionEvent): string => {
  switch (event.kind) {
    case 'start':
      return `conn_${event.record.id}_start`;
    case 'end':
      return `conn_${event.record.id}_end`;
    case 'interruption':
      return `conn_${event.record.id}_net_${Math.floor(event.from / 10_000)}`;
  }
};
