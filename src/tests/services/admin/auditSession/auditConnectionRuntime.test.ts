import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushAuditConnectionOutbox,
  writeAuditConnectionEntry,
} from '@/services/admin/auditService';
import { getCurrentUserUid } from '@/services/admin/utils/auditUtils';
import { registerPendingAuditFlush } from '@/services/admin/auditPendingEvents';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import {
  AUDIT_CONNECTION_STORAGE_KEY,
  readAuditConnection,
} from '@/services/admin/auditSession/auditConnectionTracker';
import {
  AUDIT_CONNECTION_OUTBOX_PREFIX,
  readAuditConnectionOutbox,
} from '@/services/admin/auditSession/auditConnectionOutbox';

// The setup file replaces the runtime for every other test; this file exercises the real one.
vi.unmock('@/services/admin/auditSession/auditConnectionRuntime');

vi.mock('@/services/admin/utils/auditUtils', () => ({
  fetchAndCacheIpAddress: vi.fn().mockResolvedValue('10.0.0.9'),
  getCachedIpAddress: vi.fn(() => '10.0.0.9'),
  getCurrentUserUid: vi.fn(() => 'uid-nurse'),
}));

const NURSE = { uid: 'uid-nurse', email: 'enfermera@hospital.test', name: 'Enfermera Uno' };

const loadRuntime = () => import('@/services/admin/auditSession/auditConnectionRuntime');

describe('audit connection runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getCurrentUserUid).mockReturnValue('uid-nurse');
    vi.mocked(flushAuditConnectionOutbox).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the connection with where it was opened and delivers its start', async () => {
    const runtime = await loadRuntime();
    await runtime.beginCurrentAuditConnection(NURSE);

    const record = readAuditConnection(localStorage);
    expect(record).toMatchObject({ uid: NURSE.uid, ipAddress: '10.0.0.9' });
    expect(readAuditConnectionOutbox(localStorage)[0].entry).toMatchObject({
      action: 'USER_LOGIN',
      sessionId: record?.id,
      ipAddress: '10.0.0.9',
    });
    expect(flushAuditConnectionOutbox).toHaveBeenCalled();
  });

  it('opens nothing when the person signed out while the IP was being looked up', async () => {
    vi.mocked(getCurrentUserUid).mockReturnValue(undefined);
    const runtime = await loadRuntime();
    await runtime.beginCurrentAuditConnection(NURSE);

    expect(readAuditConnection(localStorage)).toBeNull();
    expect(readAuditConnectionOutbox(localStorage)).toEqual([]);
  });

  it('discards an event built from a malformed device record and still opens the connection', async () => {
    // A previous connection someone edited on the device: no email to attribute its end to.
    localStorage.setItem(
      AUDIT_CONNECTION_STORAGE_KEY,
      JSON.stringify({ id: 'planted', uid: 'uid-other', email: '', startedAt: 1, lastSeenAt: 2 })
    );
    const runtime = await loadRuntime();
    await runtime.beginCurrentAuditConnection(NURSE);

    expect(readAuditConnectionOutbox(localStorage).map(item => item.entry.action)).toEqual([
      'USER_LOGIN',
    ]);
    expect(writeAuditConnectionEntry).not.toHaveBeenCalled();
  });

  it('records the end, flushes pending edits and never waits more than the budget', async () => {
    const runtime = await loadRuntime();
    await runtime.beginCurrentAuditConnection(NURSE);
    vi.useFakeTimers();
    const pendingEdit = vi.fn(() => new Promise<void>(() => undefined));
    const unregister = registerPendingAuditFlush(pendingEdit);
    vi.mocked(flushAuditConnectionOutbox).mockReturnValue(new Promise(() => undefined));

    const ending = runtime.endCurrentAuditConnection('manual');
    expect(readAuditConnection(localStorage)?.endedAt).toEqual(expect.any(Number));
    expect(pendingEdit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(ending).resolves.toBeUndefined();

    unregister();
    expect(readAuditConnectionOutbox(localStorage).map(item => item.entry.action)).toEqual([
      'USER_LOGIN',
      'USER_LOGOUT',
    ]);
  });

  it('keeps the previous person’s end on the device even with a full queue', async () => {
    for (let index = 0; index < 500; index += 1) {
      const entry = buildAuditConnectionEntry({
        kind: 'start',
        record: {
          id: `filler-${index}`,
          uid: 'uid-filler',
          email: 'relleno@hospital.test',
          startedAt: 1_000 + index,
          lastSeenAt: 1_000 + index,
        },
        start: 'sign_in',
      });
      localStorage.setItem(
        `${AUDIT_CONNECTION_OUTBOX_PREFIX}${entry.id}`,
        JSON.stringify({ entry })
      );
    }
    localStorage.setItem(
      AUDIT_CONNECTION_STORAGE_KEY,
      JSON.stringify({
        id: 'previous-person',
        uid: 'uid-other',
        email: 'otra.persona@hospital.test',
        startedAt: Date.parse('2026-10-21T10:00:00.000Z'),
        lastSeenAt: Date.parse('2026-10-21T11:00:00.000Z'),
      })
    );

    const runtime = await loadRuntime();
    await runtime.beginCurrentAuditConnection(NURSE);

    // Her end waits on the device for her own next session; nobody else writes it.
    const ends = readAuditConnectionOutbox(localStorage).filter(
      item => item.entry.userUid === 'uid-other'
    );
    expect(ends.map(item => item.entry.action)).toEqual(['USER_LOGOUT']);
    // The nurse's own start found the queue full and was written by her session.
    expect(vi.mocked(writeAuditConnectionEntry).mock.calls.map(([entry]) => entry.userUid)).toEqual(
      ['uid-nurse']
    );
  });

  it('writes a connection event directly when the device cannot keep it, only its own', async () => {
    // Another person's connection was left open on this device: its end belongs to them.
    localStorage.setItem(
      AUDIT_CONNECTION_STORAGE_KEY,
      JSON.stringify({
        id: 'previous-person',
        uid: 'uid-other',
        email: 'otra.persona@hospital.test',
        startedAt: Date.parse('2026-10-21T10:00:00.000Z'),
        lastSeenAt: Date.parse('2026-10-21T11:00:00.000Z'),
      })
    );
    // The test setup gives localStorage a vi.fn store; refuse only the outbox key.
    const setItem = vi.mocked(localStorage.setItem);
    const keep = setItem.getMockImplementation();
    setItem.mockImplementation((key: string, value: string) => {
      if (key.startsWith(AUDIT_CONNECTION_OUTBOX_PREFIX)) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      keep?.(key, value);
    });
    try {
      const runtime = await loadRuntime();
      await runtime.beginCurrentAuditConnection(NURSE);
    } finally {
      if (keep) setItem.mockImplementation(keep);
    }

    expect(localStorage.getItem(AUDIT_CONNECTION_STORAGE_KEY)).not.toBeNull();
    // Only the nurse's own start is written by her session; the other person's end is not.
    expect(vi.mocked(writeAuditConnectionEntry).mock.calls.map(([entry]) => entry.userUid)).toEqual(
      ['uid-nurse']
    );
    expect(writeAuditConnectionEntry).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_LOGIN' })
    );
  });
});
