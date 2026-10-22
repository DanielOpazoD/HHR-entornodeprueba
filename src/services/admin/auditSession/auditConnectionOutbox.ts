import type { AuditLogEntry } from '@/types/auditLogTypes';

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

export const readAuditConnectionOutbox = (
  storage: Pick<Storage, 'getItem'>
): AuditConnectionOutboxItem[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(AUDIT_CONNECTION_OUTBOX_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is AuditConnectionOutboxItem =>
            Boolean(item) && typeof (item as AuditConnectionOutboxItem).entry?.id === 'string'
        )
      : [];
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
