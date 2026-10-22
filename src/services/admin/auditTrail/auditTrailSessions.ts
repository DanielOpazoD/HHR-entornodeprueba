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

/** Connected time: known end, or last recorded activity while the session stays open. */
export const resolveAuditTrailSessionDurationMs = (session: AuditTrailSession): number =>
  Math.max(0, (session.endedAt ?? session.lastSeenAt) - session.startedAt);
