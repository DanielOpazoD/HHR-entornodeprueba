import { describe, expect, it } from 'vitest';
import {
  AUDIT_CONNECTION_MIN_OFFLINE_MS,
  AUDIT_CONNECTION_RESUME_GAP_MS,
  beginAuditConnection,
  endAuditConnection,
  markAuditConnectionOffline,
  markAuditConnectionOnline,
  readAuditConnection,
  recordAuditConnectionEndLocally,
  resolveAuditConnectionId,
  touchAuditConnection,
  type AuditConnectionDependencies,
  type AuditConnectionEvent,
} from '@/services/admin/auditSession/auditConnectionTracker';
import { buildAuditConnectionEntry } from '@/services/admin/auditSession/auditConnectionEntries';
import { resolveAuditDeviceLabel } from '@/services/admin/auditSession/auditDeviceLabel';

const NURSE = { uid: 'uid-nurse', email: 'enfermera@hospital.test', name: 'Enfermera Uno' };
const DOCTOR = { uid: 'uid-doctor', email: 'medico@hospital.test', name: 'Médico Dos' };

/** One device: shared storage across its tabs, a manual clock and the emitted events. */
const device = () => {
  const values = new Map<string, string>();
  const events: AuditConnectionEvent[] = [];
  let now = Date.parse('2026-10-22T13:00:00.000Z');
  let ids = 0;
  const deps: AuditConnectionDependencies = {
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    },
    now: () => now,
    createId: () => `conn-${(ids += 1)}`,
    emit: event => void events.push(event),
    withLock: async task => task(),
  };
  return {
    deps,
    events,
    advance: (ms: number) => {
      now += ms;
    },
    kinds: () => events.map(event => `${event.kind}:${event.record.id}`),
  };
};

/** An open tab beats every minute while someone uses the app. */
const useFor = async (pc: ReturnType<typeof device>, minutes: number) => {
  for (let minute = 0; minute < minutes; minute += 1) {
    pc.advance(60_000);
    await touchAuditConnection(NURSE, pc.deps);
  }
};

describe('audit connection tracker', () => {
  it('opens one connection per device and lets other tabs join it', async () => {
    const pc = device();
    const firstTab = await beginAuditConnection(NURSE, pc.deps);
    pc.advance(5 * 60_000);
    const secondTab = await beginAuditConnection(NURSE, pc.deps);

    expect(secondTab).toBe(firstTab);
    expect(pc.events).toEqual([expect.objectContaining({ kind: 'start', start: 'sign_in' })]);
    expect(resolveAuditConnectionId(pc.deps.storage, NURSE.uid)).toBe(firstTab);
    expect(resolveAuditConnectionId(pc.deps.storage, DOCTOR.uid)).toBeUndefined();
  });

  it('closes a connection left open at its last heartbeat when the device returns', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    await useFor(pc, 30);
    const lastSeen = readAuditConnection(pc.deps.storage)?.lastSeenAt;

    // The browser stays closed overnight.
    pc.advance(10 * 60 * 60_000);
    await beginAuditConnection(NURSE, pc.deps);

    expect(pc.kinds()).toEqual(['start:conn-1', 'end:conn-1', 'start:conn-2']);
    expect(pc.events[1]).toMatchObject({ reason: 'closed', endedAt: lastSeen });
    expect(pc.events[2]).toMatchObject({ start: 'resume' });
  });

  it('splits the connection when a sleeping device wakes up after the resume gap', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    pc.advance(AUDIT_CONNECTION_RESUME_GAP_MS + 1);
    await touchAuditConnection(NURSE, pc.deps);

    expect(pc.kinds()).toEqual(['start:conn-1', 'end:conn-1', 'start:conn-2']);
  });

  it('ends the connection once even if every tab logs out', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    await useFor(pc, 120);
    endAuditConnection(NURSE.uid, 'automatic', pc.deps);
    endAuditConnection(NURSE.uid, 'automatic', pc.deps);

    expect(pc.kinds()).toEqual(['start:conn-1', 'end:conn-1']);
    expect(pc.events[1]).toMatchObject({ reason: 'automatic' });

    // The next person on this shared computer starts with a sign-in.
    await beginAuditConnection(DOCTOR, pc.deps);
    expect(pc.events[2]).toMatchObject({ kind: 'start', start: 'sign_in' });
  });

  it('keeps the last heartbeat when an old connection is closed by the inactivity logout', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    const lastSeen = pc.deps.now();
    // The browser reopens ten hours later and the 8 h inactivity logout fires first.
    pc.advance(10 * 60 * 60_000);
    endAuditConnection(NURSE.uid, 'automatic', pc.deps);

    expect(pc.events[1]).toMatchObject({ kind: 'end', reason: 'closed', endedAt: lastSeen });
  });

  it('closes the previous person connection when someone else signs in', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    pc.advance(60_000);
    await beginAuditConnection(DOCTOR, pc.deps);

    expect(pc.events.map(event => [event.kind, event.record.email])).toEqual([
      ['start', NURSE.email],
      ['end', NURSE.email],
      ['start', DOCTOR.email],
    ]);
  });

  it('sends a logout made from the bootstrap shell at the next start', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    pc.advance(45 * 60_000);
    recordAuditConnectionEndLocally(pc.deps.storage, 'manual', pc.deps.now());
    const endedAt = pc.deps.now();

    pc.advance(5 * 60_000);
    await beginAuditConnection(NURSE, pc.deps);

    expect(pc.events[1]).toMatchObject({ kind: 'end', reason: 'manual', endedAt });
    expect(pc.events[2]).toMatchObject({ kind: 'start', start: 'sign_in' });
  });

  it('records network drops of a minute or more, once', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    markAuditConnectionOffline(NURSE.uid, pc.deps);
    pc.advance(20_000);
    markAuditConnectionOffline(NURSE.uid, pc.deps);
    markAuditConnectionOnline(NURSE.uid, pc.deps);
    expect(pc.events).toHaveLength(1);

    markAuditConnectionOffline(NURSE.uid, pc.deps);
    pc.advance(AUDIT_CONNECTION_MIN_OFFLINE_MS + 5_000);
    markAuditConnectionOnline(NURSE.uid, pc.deps);
    markAuditConnectionOnline(NURSE.uid, pc.deps);

    expect(pc.events.map(event => event.kind)).toEqual(['start', 'interruption']);
  });

  it('forgets an offline mark left by a page closed without network', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    markAuditConnectionOffline(NURSE.uid, pc.deps);
    // The page closes offline and reopens online a few minutes later.
    pc.advance(5 * 60_000);
    await beginAuditConnection(NURSE, pc.deps, true);
    await useFor(pc, 120);
    // Two hours later a two-second drop is not a two-hour interruption.
    markAuditConnectionOffline(NURSE.uid, pc.deps);
    pc.advance(2_000);
    markAuditConnectionOnline(NURSE.uid, pc.deps);

    expect(pc.events.map(event => event.kind)).toEqual(['start']);
  });

  it('labels a start days after the last one as a sign-in, not a reconnection', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    pc.advance(3 * 24 * 60 * 60_000);
    await beginAuditConnection(NURSE, pc.deps);

    expect(pc.events[2]).toMatchObject({ kind: 'start', start: 'sign_in' });
  });

  it('stamps edits flushed right after the end with the connection that just closed', async () => {
    const pc = device();
    const id = await beginAuditConnection(NURSE, pc.deps);
    endAuditConnection(NURSE.uid, 'manual', pc.deps);

    expect(resolveAuditConnectionId(pc.deps.storage, NURSE.uid, pc.deps.now() + 5_000)).toBe(id);
    expect(resolveAuditConnectionId(pc.deps.storage, NURSE.uid, pc.deps.now() + 60_000)).toBe(
      undefined
    );
  });

  it('stores connection events dated when they happened, with deterministic ids', async () => {
    const pc = device();
    await beginAuditConnection(NURSE, pc.deps);
    await useFor(pc, 90);
    endAuditConnection(NURSE.uid, 'manual', pc.deps);

    const [start, end] = pc.events.map(event =>
      buildAuditConnectionEntry(event, { ipAddress: '10.0.0.1', device: 'Chrome · Windows' })
    );
    expect(start).toMatchObject({
      id: 'conn_conn-1_start',
      action: 'USER_LOGIN',
      timestamp: '2026-10-22T13:00:00.000Z',
      sessionId: 'conn-1',
      userId: NURSE.email,
      userDisplayName: NURSE.name,
      details: { start: 'sign_in' },
    });
    expect(end).toMatchObject({
      id: 'conn_conn-1_end',
      action: 'USER_LOGOUT',
      timestamp: '2026-10-22T14:30:00.000Z',
      details: { reason: 'manual', durationSeconds: 5_400 },
    });
  });

  it('labels devices coarsely', () => {
    expect(
      resolveAuditDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'
      )
    ).toBe('Edge · Windows');
    expect(
      resolveAuditDeviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari · iOS');
    expect(resolveAuditDeviceLabel(undefined)).toBeUndefined();
  });
});
