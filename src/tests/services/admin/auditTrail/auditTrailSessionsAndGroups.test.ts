import { describe, expect, it } from 'vitest';
import { normalizeAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailNormalize';
import {
  buildAuditTrailSessions,
  resolveAuditTrailBoundaryIds,
  resolveAuditTrailSessionDurationMs,
} from '@/services/admin/auditTrail/auditTrailSessions';
import {
  buildAuditTrailGroups,
  buildAuditTrailLines,
} from '@/services/admin/auditTrail/auditTrailGroups';
import { auditLog, patientDetails } from './auditTrailFixtures';

const at = (time: string) => `2026-10-22T${time}:00.000Z`;
/** Evaluation time for open sessions: the same evening. */
const EVENING = Date.parse(at('18:00'));

const sessionLogs = () => [
  auditLog({
    id: 'login',
    action: 'USER_LOGIN',
    entityType: 'user',
    timestamp: at('12:00'),
    sessionId: 's1',
    device: 'Chrome · Windows',
    ipAddress: '10.0.0.1',
    details: { start: 'sign_in' },
  }),
  auditLog({
    id: 'edit',
    timestamp: at('12:30'),
    sessionId: 's1',
    details: patientDetails('Paciente Uno', { changes: { age: { old: 40, new: 41 } } }),
  }),
  auditLog({
    id: 'net',
    action: 'CONNECTION_INTERRUPTED',
    entityType: 'user',
    timestamp: at('13:05'),
    sessionId: 's1',
    details: { offlineFrom: at('13:00'), offlineTo: at('13:05'), durationSeconds: 300 },
  }),
  auditLog({
    id: 'logout',
    action: 'USER_LOGOUT',
    entityType: 'user',
    timestamp: at('14:00'),
    sessionId: 's1',
    details: { reason: 'manual', startedAt: at('12:00'), durationSeconds: 7_200 },
  }),
  auditLog({
    id: 'retro-start',
    action: 'USER_LOGIN',
    entityType: 'user',
    userId: 'medico.dos@hospital.test',
    userDisplayName: 'Médico Dos',
    timestamp: at('15:00'),
    sessionId: 's2',
  }),
  auditLog({
    id: 'retro-view',
    action: 'VIEW_PATIENT',
    userId: 'medico.dos@hospital.test',
    userDisplayName: 'Médico Dos',
    timestamp: at('15:20'),
    sessionId: 's2',
    details: patientDetails('Paciente Uno'),
  }),
  auditLog({
    id: 'retro-end',
    action: 'USER_LOGOUT',
    entityType: 'user',
    userId: 'medico.dos@hospital.test',
    userDisplayName: 'Médico Dos',
    // Written at the next start on that device, dated at the last activity.
    timestamp: at('15:40'),
    sessionId: 's2',
    details: { reason: 'closed', startedAt: at('15:00'), endedAt: at('15:40') },
  }),
  auditLog({
    id: 'open-start',
    action: 'USER_LOGIN',
    entityType: 'user',
    timestamp: at('16:00'),
    sessionId: 's3',
  }),
  auditLog({
    id: 'open-edit',
    timestamp: at('16:10'),
    sessionId: 's3',
    details: patientDetails('Paciente Dos', {
      changes: { status: { old: 'Estable', new: 'Grave' } },
    }),
  }),
];

describe('audit trail sessions', () => {
  it('pairs each start with its end, reason, duration and network gaps', () => {
    const sessions = buildAuditTrailSessions(normalizeAuditTrailEvents(sessionLogs()), EVENING);

    expect(sessions.map(session => [session.id, session.end])).toEqual([
      ['s3', 'open'],
      ['s2', 'closed'],
      ['s1', 'manual'],
    ]);
    const [open, closed, manual] = sessions;
    expect(manual).toMatchObject({
      device: 'Chrome · Windows',
      ipAddress: '10.0.0.1',
      interruptions: [{ from: Date.parse(at('13:00')), to: Date.parse(at('13:05')) }],
    });
    expect(resolveAuditTrailSessionDurationMs(manual)).toBe(2 * 60 * 60 * 1000);
    expect(closed.actor.name).toBe('Médico Dos');
    expect(resolveAuditTrailSessionDurationMs(closed)).toBe(40 * 60 * 1000);
    // Still open: the duration runs to the last recorded activity.
    expect(open.endedAt).toBeUndefined();
    expect(resolveAuditTrailSessionDurationMs(open)).toBe(10 * 60 * 1000);
  });

  it('stops calling a session without an end "open" once it has been silent for hours', () => {
    const [unclosed] = buildAuditTrailSessions(
      normalizeAuditTrailEvents(sessionLogs()),
      Date.parse('2026-10-23T12:00:00.000Z')
    );
    expect(unclosed).toMatchObject({ id: 's3', end: 'unknown', endedAt: undefined });
  });

  it('asks for the start and end a period cut off, and times a night shift from them', () => {
    // Night shift seen on its second day: started the evening before, still working at noon.
    const day = [
      auditLog({
        id: 'night-edit',
        timestamp: at('11:30'),
        sessionId: 'night-1',
        details: patientDetails('Paciente Uno', { changes: { age: { old: 40, new: 41 } } }),
      }),
    ];
    expect(resolveAuditTrailBoundaryIds([...day, ...sessionLogs()])).toEqual([
      'conn_night-1_start',
      'conn_night-1_end',
      'conn_s3_end',
    ]);

    const boundary = [
      auditLog({
        id: 'conn_night-1_start',
        action: 'USER_LOGIN',
        entityType: 'user',
        timestamp: '2026-10-21T23:30:00.000Z',
        sessionId: 'night-1',
        details: { start: 'sign_in' },
      }),
      auditLog({
        id: 'conn_night-1_end',
        action: 'USER_LOGOUT',
        entityType: 'user',
        timestamp: '2026-10-23T00:30:00.000Z',
        sessionId: 'night-1',
        details: { reason: 'manual', startedAt: '2026-10-21T23:30:00.000Z' },
      }),
    ];
    const [night] = buildAuditTrailSessions(
      normalizeAuditTrailEvents([...day, ...boundary]),
      EVENING
    );
    expect(night).toMatchObject({ id: 'night-1', end: 'manual' });
    expect(resolveAuditTrailSessionDurationMs(night)).toBe(25 * 60 * 60 * 1000);
  });

  it('uses the end record when the start fell outside the loaded period', () => {
    const [session] = buildAuditTrailSessions(
      normalizeAuditTrailEvents(sessionLogs().filter(log => log.id === 'logout'))
    );
    expect(session.startedAt).toBe(Date.parse(at('12:00')));
  });
});

describe('audit trail groups', () => {
  const events = normalizeAuditTrailEvents(sessionLogs());

  it('groups by patient with general, connection and system groups last', () => {
    const groups = buildAuditTrailGroups(events, 'patient');
    expect(groups.map(group => group.title)).toEqual([
      'Paciente Dos',
      'Paciente Uno',
      'Conexiones',
    ]);
    const patientOne = groups[1];
    expect(patientOne).toMatchObject({ actorCount: 2, patientCount: 1 });
    expect(patientOne.counts).toMatchObject({ change: 1, access: 1 });
  });

  it('groups by staff member, by connection and by hospital day', () => {
    expect(buildAuditTrailGroups(events, 'actor').map(group => group.title)).toEqual([
      'Enfermera Uno',
      'Médico Dos',
    ]);

    const sessions = buildAuditTrailSessions(events, EVENING);
    const bySession = buildAuditTrailGroups(
      [...events, ...normalizeAuditTrailEvents([auditLog({ id: 'server', sessionId: undefined })])],
      'session',
      sessions
    );
    expect(bySession.map(group => group.key)).toEqual(['s3', 's2', 's1', '~no-session']);
    expect(bySession[2].session?.end).toBe('manual');

    // 04:30Z on Oct 23 is still Oct 22 in Rapa Nui (UTC-5).
    const lateNight = normalizeAuditTrailEvents([
      auditLog({ timestamp: '2026-10-23T04:30:00.000Z' }),
      auditLog({ timestamp: '2026-10-23T05:30:00.000Z' }),
    ]);
    expect(buildAuditTrailGroups(lateNight, 'time').map(group => group.title)).toEqual([
      '23-10-2026',
      '22-10-2026',
    ]);
  });

  it('collapses repeated reads and edit bursts but keeps people and patients apart', () => {
    const lines = buildAuditTrailLines(
      normalizeAuditTrailEvents([
        auditLog({ action: 'VIEW_PATIENT', timestamp: at('10:00'), details: patientDetails('A') }),
        auditLog({ action: 'VIEW_PATIENT', timestamp: at('10:10'), details: patientDetails('A') }),
        auditLog({ action: 'VIEW_PATIENT', timestamp: at('10:20'), details: patientDetails('A') }),
        auditLog({
          timestamp: at('10:30'),
          details: patientDetails('A', { changes: { age: { old: 1, new: 2 } } }),
        }),
        auditLog({
          timestamp: at('10:32'),
          details: patientDetails('A', { changes: { status: { old: 'x', new: 'y' } } }),
        }),
        auditLog({
          timestamp: at('10:33'),
          details: patientDetails('B', { changes: { status: { old: 'x', new: 'y' } } }),
        }),
        auditLog({
          timestamp: at('10:34'),
          userId: 'otra@hospital.test',
          details: patientDetails('B', { changes: { age: { old: 3, new: 4 } } }),
        }),
      ])
    );

    expect(lines.map(line => line.events.length)).toEqual([1, 1, 2, 3]);
    expect(lines[3].events.every(event => event.action === 'VIEW_PATIENT')).toBe(true);
  });
});
