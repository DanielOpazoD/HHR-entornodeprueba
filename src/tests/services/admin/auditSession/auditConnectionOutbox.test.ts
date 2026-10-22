import { describe, expect, it } from 'vitest';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import {
  AUDIT_CONNECTION_OUTBOX_KEY,
  enqueueAuditConnectionEntry,
  readAuditConnectionOutbox,
} from '@/services/admin/auditSession/auditConnectionOutbox';
import type { AuditConnectionRecord } from '@/services/admin/auditSession/auditConnectionTracker';

const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
};

const RECORD: AuditConnectionRecord = {
  id: '6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f',
  uid: 'uid-nurse',
  email: 'enfermera@hospital.test',
  name: 'Enfermera Uno',
  ipAddress: '10.0.0.9',
  device: 'Chrome · Windows',
  startedAt: Date.parse('2026-10-22T13:00:00.000Z'),
  lastSeenAt: Date.parse('2026-10-22T14:00:00.000Z'),
};

const [START, END, DROP] = [
  buildAuditConnectionEntry({ kind: 'start', record: RECORD, start: 'resume' }),
  buildAuditConnectionEntry({
    kind: 'end',
    record: RECORD,
    reason: 'closed',
    endedAt: RECORD.lastSeenAt,
  }),
  buildAuditConnectionEntry({
    kind: 'interruption',
    record: RECORD,
    from: RECORD.startedAt,
    to: RECORD.startedAt + 120_000,
  }),
];

const plant = (storage: Pick<Storage, 'setItem'>, items: unknown) =>
  storage.setItem(AUDIT_CONNECTION_OUTBOX_KEY, JSON.stringify(items));

describe('audit connection outbox', () => {
  it('keeps every event the tracker writes exactly as built', () => {
    const storage = memoryStorage();
    [START, END, DROP].forEach(entry => {
      expect(enqueueAuditConnectionEntry(storage, entry)).toBe(true);
    });

    expect(readAuditConnectionOutbox(storage).map(item => item.entry)).toEqual([START, END, DROP]);
  });

  it('refuses what the tracker never writes instead of sending it under the next session', () => {
    const storage = memoryStorage();
    plant(storage, [
      { entry: { ...END, action: 'PATIENT_CLEARED' } },
      { entry: { ...END, id: 'conn_other-session_end' } },
      { entry: { ...END, details: { ...END.details, reason: 'deleted' } } },
      { entry: { ...END, details: { ...END.details, sessionId: 'other-session' } } },
      { entry: { ...START, entityId: 'otra.persona@hospital.test' } },
      { entry: 'conn_x_end' },
      null,
      {
        entry: {
          ...START,
          patientIdentifier: '12345***-*',
          details: { ...START.details, changes: { diagnosis: { old: 'A', new: 'B' } } },
        },
        sentAt: 'soon',
        rejections: -1,
      },
    ]);

    // Only the well-formed start survives, rebuilt without the fields the tracker never writes.
    expect(readAuditConnectionOutbox(storage)).toEqual([{ entry: START }]);
  });

  it('clears planted items from the device on the next write', () => {
    const storage = memoryStorage();
    plant(storage, [{ entry: { ...END, action: 'PATIENT_CLEARED' } }]);

    enqueueAuditConnectionEntry(storage, START);

    expect(JSON.parse(storage.getItem(AUDIT_CONNECTION_OUTBOX_KEY) ?? '[]')).toEqual([
      { entry: START },
    ]);
    plant(storage, { entry: START });
    expect(readAuditConnectionOutbox(storage)).toEqual([]);
  });
});
