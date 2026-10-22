import { describe, expect, it } from 'vitest';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import {
  AUDIT_CONNECTION_OUTBOX_PREFIX,
  enqueueAuditConnectionEntry,
  markAuditConnectionEntrySent,
  readAuditConnectionOutbox,
  settleAuditConnectionEntry,
  type AuditConnectionOutboxStorage,
} from '@/services/admin/auditSession/auditConnectionOutbox';
import type { AuditConnectionRecord } from '@/services/admin/auditSession/auditConnectionTracker';

const memoryStorage = (): AuditConnectionOutboxStorage => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
};

const record = (id: string, startedAt = Date.parse('2026-10-22T13:00:00.000Z')) =>
  ({
    id,
    uid: 'uid-nurse',
    email: 'enfermera@hospital.test',
    name: 'Enfermera Uno',
    ipAddress: '10.0.0.9',
    device: 'Chrome · Windows',
    startedAt,
    lastSeenAt: startedAt + 3_600_000,
  }) satisfies AuditConnectionRecord;

const RECORD = record('6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f');
const START = buildAuditConnectionEntry({ kind: 'start', record: RECORD, start: 'resume' });
const END = buildAuditConnectionEntry({
  kind: 'end',
  record: RECORD,
  reason: 'closed',
  endedAt: RECORD.lastSeenAt,
});
const DROP = buildAuditConnectionEntry({
  kind: 'interruption',
  record: RECORD,
  from: RECORD.startedAt,
  to: RECORD.startedAt + 120_000,
});

const plant = (storage: AuditConnectionOutboxStorage, id: string, value: unknown) =>
  storage.setItem(AUDIT_CONNECTION_OUTBOX_PREFIX + id, JSON.stringify(value));

describe('audit connection outbox', () => {
  it('keeps every event the tracker writes exactly as built, oldest first', () => {
    const storage = memoryStorage();
    [END, DROP, START].forEach(entry => {
      expect(enqueueAuditConnectionEntry(storage, entry)).toBe(true);
    });

    expect(readAuditConnectionOutbox(storage).map(item => item.entry)).toEqual([START, DROP, END]);
  });

  it('orders a start, a network drop and an end recorded in the same millisecond', () => {
    const storage = memoryStorage();
    const instant = record('same-instant');
    enqueueAuditConnectionEntry(
      storage,
      buildAuditConnectionEntry({
        kind: 'end',
        record: instant,
        reason: 'manual',
        endedAt: instant.startedAt,
      })
    );
    enqueueAuditConnectionEntry(
      storage,
      buildAuditConnectionEntry({
        kind: 'interruption',
        record: instant,
        from: instant.startedAt - 120_000,
        to: instant.startedAt,
      })
    );
    enqueueAuditConnectionEntry(
      storage,
      buildAuditConnectionEntry({ kind: 'start', record: instant, start: 'sign_in' })
    );

    expect(readAuditConnectionOutbox(storage).map(item => item.entry.action)).toEqual([
      'USER_LOGIN',
      'CONNECTION_INTERRUPTED',
      'USER_LOGOUT',
    ]);
  });

  it('refuses what the tracker never writes instead of sending it under the next session', () => {
    const storage = memoryStorage();
    plant(storage, END.id, { entry: { ...END, action: 'PATIENT_CLEARED' } });
    plant(storage, 'conn_other-session_end', { entry: { ...END, id: 'conn_other-session_end' } });
    plant(storage, DROP.id, { entry: END });
    plant(storage, 'conn_x_end', 'conn_x_end');
    plant(storage, START.id, {
      entry: {
        ...START,
        patientIdentifier: '12345***-*',
        details: { ...START.details, changes: { diagnosis: { old: 'A', new: 'B' } } },
      },
      sentAt: 'soon',
      rejections: -1,
    });

    // Only the well-formed start survives, rebuilt without the fields the tracker never writes.
    expect(readAuditConnectionOutbox(storage)).toEqual([{ entry: START }]);
  });

  it('never loses an event another tab added while this one settled its own', () => {
    const storage = memoryStorage();
    enqueueAuditConnectionEntry(storage, START);
    // This tab is delivering the start when another tab queues the end.
    markAuditConnectionEntrySent(storage, START.id, 1);
    enqueueAuditConnectionEntry(storage, END);
    settleAuditConnectionEntry(storage, START.id, 'stored');

    expect(readAuditConnectionOutbox(storage)).toEqual([{ entry: END }]);
  });

  it('keeps refused events with their count and clears planted keys on write', () => {
    const storage = memoryStorage();
    enqueueAuditConnectionEntry(storage, END);
    markAuditConnectionEntrySent(storage, END.id, 1);
    settleAuditConnectionEntry(storage, END.id, 'rejected');
    expect(readAuditConnectionOutbox(storage)).toEqual([{ entry: END, rejections: 1 }]);

    plant(storage, 'conn_x_end', { entry: { ...END, action: 'PATIENT_CLEARED' } });
    enqueueAuditConnectionEntry(storage, START);

    expect(storage.getItem(AUDIT_CONNECTION_OUTBOX_PREFIX + 'conn_x_end')).toBeNull();
    expect(readAuditConnectionOutbox(storage).map(item => item.entry)).toEqual([START, END]);
  });

  it('never drops a queued event: a full queue refuses the new one instead', () => {
    const storage = memoryStorage();
    const queued = Array.from({ length: 500 }, (_, index) =>
      buildAuditConnectionEntry({
        kind: 'start',
        record: record(`session-${index}`, RECORD.startedAt + 1_000 * index),
        start: 'sign_in',
      })
    );
    queued.forEach(entry => expect(enqueueAuditConnectionEntry(storage, entry)).toBe(true));

    // Even an older event (a retroactive end) does not push anything out.
    expect(enqueueAuditConnectionEntry(storage, END)).toBe(false);
    expect(readAuditConnectionOutbox(storage)).toHaveLength(500);
    // An event already queued can still be written again.
    expect(enqueueAuditConnectionEntry(storage, queued[0])).toBe(true);
  });
});
