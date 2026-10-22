import {
  flushAuditConnectionOutbox,
  writeAuditConnectionEntry,
} from '@/services/admin/auditService';
import { auditCoreLogger } from '@/services/admin/adminLoggers';
import { flushPendingAuditEvents } from '@/services/admin/auditPendingEvents';
import {
  fetchAndCacheIpAddress,
  getCachedIpAddress,
  getCurrentUserUid,
} from '@/services/admin/utils/auditUtils';
import {
  beginAuditConnection,
  endAuditConnection,
  markAuditConnectionOffline,
  markAuditConnectionOnline,
  touchAuditConnection,
  type AuditConnectionDependencies,
  type AuditConnectionEndReason,
  type AuditConnectionIdentity,
} from '@/services/admin/auditSession/auditConnectionTracker';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import {
  enqueueAuditConnectionEntry,
  toAuditConnectionEntry,
} from '@/services/admin/auditSession/auditConnectionOutbox';
import { resolveAuditDeviceLabel } from '@/services/admin/auditSession/auditDeviceLabel';

const LOCK_NAME = 'hhr-audit-connection';
/** The IP is a best-effort enrichment; the start is not held back longer than this. */
const IP_LOOKUP_BUDGET_MS = 1_500;
/** Longest wait before Firebase signs out; whatever is not delivered stays queued on the device. */
const LOGOUT_DELIVERY_BUDGET_MS = 1_500;

const withinBudget = (task: Promise<unknown>, budgetMs: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, budgetMs);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    task.then(settle, settle);
  });

const withLock = <T>(task: () => T): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks?.request
    ? (locks.request(LOCK_NAME, () => task()) as Promise<T>)
    : Promise.resolve().then(task);
};

const deviceLabel = (): string | undefined =>
  resolveAuditDeviceLabel(typeof navigator === 'undefined' ? undefined : navigator.userAgent);

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

const dependencies = (): AuditConnectionDependencies => ({
  storage: window.localStorage,
  now: Date.now,
  createId: () => crypto.randomUUID(),
  withLock,
  emit: event => {
    // The stored record behind the event is device data too: only a well-formed event leaves.
    const entry = toAuditConnectionEntry(
      buildAuditConnectionEntry(event, { ipAddress: getCachedIpAddress(), device: deviceLabel() })
    );
    if (!entry) {
      auditCoreLogger.warn('Malformed connection event discarded', { kind: event.kind });
      return;
    }
    // Without device storage the event cannot wait in the outbox: write it straight away.
    if (!enqueueAuditConnectionEntry(window.localStorage, entry) && getCurrentUserUid()) {
      void writeAuditConnectionEntry(entry);
    }
  },
});

const DELIVERY_LOCK_NAME = 'hhr-audit-connection-delivery';

/**
 * Writes queued connection events while someone is signed in (the rules require it). One tab at
 * a time: two tabs sending the same event would leave the refused copy queued.
 */
const deliver = (): Promise<void> => {
  if (!getCurrentUserUid() || isOffline()) return Promise.resolve();
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks?.request
    ? (locks.request(DELIVERY_LOCK_NAME, () => flushAuditConnectionOutbox()) as Promise<void>)
    : flushAuditConnectionOutbox();
};

export const beginCurrentAuditConnection = async (
  identity: AuditConnectionIdentity
): Promise<void> => {
  await withinBudget(fetchAndCacheIpAddress(), IP_LOOKUP_BUDGET_MS);
  // Signed out (or someone else signed in) during the wait: there is nothing to open.
  if (getCurrentUserUid() !== identity.uid) return;
  await beginAuditConnection(
    { ...identity, ipAddress: getCachedIpAddress(), device: deviceLabel() },
    dependencies(),
    !isOffline()
  );
  await deliver();
};

export const touchCurrentAuditConnection = async (
  identity: AuditConnectionIdentity
): Promise<void> => {
  await touchAuditConnection(identity, dependencies());
  await deliver();
};

export const markCurrentAuditConnectionOffline = (uid: string): void =>
  markAuditConnectionOffline(uid, dependencies());

export const markCurrentAuditConnectionOnline = async (uid: string): Promise<void> => {
  markAuditConnectionOnline(uid, dependencies());
  await deliver();
};

/**
 * Records the end, then writes pending edits and the end event while still signed in. Both share
 * one bounded wait; edits written right after the end keep the connection id.
 */
export const endCurrentAuditConnection = async (
  reason: AuditConnectionEndReason,
  uid: string | undefined = getCurrentUserUid()
): Promise<void> => {
  endAuditConnection(uid, reason, dependencies());
  await withinBudget(
    Promise.allSettled([flushPendingAuditEvents(), deliver()]),
    LOGOUT_DELIVERY_BUDGET_MS
  );
};
