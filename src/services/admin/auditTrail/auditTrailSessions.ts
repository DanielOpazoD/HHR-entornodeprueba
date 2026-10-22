import type { AuditLogEntry } from '@/types/auditLogTypes';
import type {
  AuditTrailEvent,
  AuditTrailInterruption,
  AuditTrailSession,
  AuditTrailSessionEnd,
} from '@/types/auditTrailTypes';
import { asAuditText } from '@/services/admin/auditTrail/auditTrailValues';
import { parseAuditTrailTimestamp } from '@/services/admin/auditTrail/auditTrailNormalize';

const END_REASONS: Record<string, AuditTrailSessionEnd> = {
  manual: 'manual',
  automatic: 'automatic',
  inactivity: 'automatic',
  expired: 'automatic',
  closed: 'closed',
};

export const AUDIT_TRAIL_SESSION_END_LABELS: Record<AuditTrailSessionEnd, string> = {
  manual: 'Cerró sesión',
  automatic: 'Cierre automático',
  closed: 'Ventana cerrada',
  open: 'En curso',
  unknown: 'Sin cierre registrado',
};

/** Without an end, a session silent this long is no longer shown as running. */
const OPEN_SESSION_WINDOW_MS = 12 * 60 * 60_000;

const detailsOf = (event: AuditTrailEvent): Record<string, unknown> =>
  (event.source.details ?? {}) as Record<string, unknown>;

const timeFrom = (value: unknown): number | undefined =>
  parseAuditTrailTimestamp(value) ?? undefined;

const toInterruption = (event: AuditTrailEvent): AuditTrailInterruption => {
  const details = detailsOf(event);
  const to = timeFrom(details.offlineTo) ?? event.at;
  const durationMs =
    typeof details.durationSeconds === 'number' ? details.durationSeconds * 1000 : 0;
  return { from: timeFrom(details.offlineFrom) ?? to - durationMs, to };
};

const buildSession = (id: string, events: AuditTrailEvent[], now: number): AuditTrailSession => {
  const chronological = [...events].sort((a, b) => a.at - b.at);
  const login = chronological.find(event => event.action === 'USER_LOGIN');
  const logout = [...chronological].reverse().find(event => event.action === 'USER_LOGOUT');
  const logoutDetails = logout ? detailsOf(logout) : {};
  const activity = chronological.filter(event => event.action !== 'USER_LOGOUT');
  const reference = login ?? chronological[0];

  const startedAt = login?.at ?? timeFrom(logoutDetails.startedAt) ?? chronological[0].at;
  const endedAt = logout ? (timeFrom(logoutDetails.endedAt) ?? logout.at) : undefined;
  const lastSeenAt = activity.length > 0 ? activity[activity.length - 1].at : startedAt;
  const unendedState = now - lastSeenAt <= OPEN_SESSION_WINDOW_MS ? 'open' : 'unknown';

  return {
    id,
    actor: reference.actor,
    device: login?.device ?? events.find(event => event.device)?.device,
    ipAddress: login?.ipAddress ?? events.find(event => event.ipAddress)?.ipAddress,
    startedAt,
    endedAt,
    lastSeenAt,
    end: logout ? (END_REASONS[asAuditText(logoutDetails.reason)] ?? 'manual') : unendedState,
    interruptions: chronological
      .filter(event => event.action === 'CONNECTION_INTERRUPTED')
      .map(toInterruption),
    events: [...chronological].reverse(),
  };
};

/** One entry per connection session (`sessionId`), newest first. Events without one are skipped. */
export const buildAuditTrailSessions = (
  events: AuditTrailEvent[],
  now: number = Date.now()
): AuditTrailSession[] => {
  const bySession = new Map<string, AuditTrailEvent[]>();
  events.forEach(event => {
    if (!event.sessionId) return;
    const sessionEvents = bySession.get(event.sessionId) ?? [];
    sessionEvents.push(event);
    bySession.set(event.sessionId, sessionEvents);
  });

  return [...bySession.entries()]
    .map(([id, sessionEvents]) => buildSession(id, sessionEvents, now))
    .sort((a, b) => b.startedAt - a.startedAt);
};

const CONNECTION_SESSION_ID = /^[\w-]{1,64}$/;
/** Each id is one document read; a period rarely has more open-ended connections than this. */
export const AUDIT_TRAIL_BOUNDARY_LIMIT = 120;

/**
 * Ids of the connection events a period cuts off: the start of a connection opened before it
 * (a night shift seen the next day) and the end of one closed after it. Connection events have
 * deterministic ids (`conn_<id>_start|end`), so each is a single document read.
 */
export const resolveAuditTrailBoundaryIds = (logs: AuditLogEntry[]): string[] => {
  const known = new Map<string, { start: boolean; end: boolean }>();
  logs.forEach(log => {
    const details = (log.details ?? {}) as Record<string, unknown>;
    const sessionId = asAuditText(log.sessionId) || asAuditText(details.sessionId);
    if (!CONNECTION_SESSION_ID.test(sessionId)) return;
    const session = known.get(sessionId) ?? { start: false, end: false };
    if (log.action === 'USER_LOGIN') session.start = true;
    if (log.action === 'USER_LOGOUT') {
      session.end = true;
      // An end carries its start time: the start event itself is not needed.
      if (timeFrom(details.startedAt) !== undefined) session.start = true;
    }
    known.set(sessionId, session);
  });
  return [...known.entries()]
    .flatMap(([id, session]) => [
      ...(session.start ? [] : [`conn_${id}_start`]),
      ...(session.end ? [] : [`conn_${id}_end`]),
    ])
    .slice(0, AUDIT_TRAIL_BOUNDARY_LIMIT);
};

/** Connected time: known end, or last recorded activity while the session stays open. */
export const resolveAuditTrailSessionDurationMs = (session: AuditTrailSession): number =>
  Math.max(0, (session.endedAt ?? session.lastSeenAt) - session.startedAt);
