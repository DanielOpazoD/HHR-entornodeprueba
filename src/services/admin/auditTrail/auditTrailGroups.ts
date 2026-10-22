import type {
  AuditTrailCounts,
  AuditTrailEvent,
  AuditTrailGroup,
  AuditTrailGrouping,
  AuditTrailLine,
  AuditTrailSession,
} from '@/types/auditTrailTypes';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

/** Consecutive reads of the same screen collapse into one line ("Vio ficha ×3"). */
const ACCESS_MERGE_WINDOW_MS = 30 * 60 * 1000;
/** A burst of edits by one person on one patient reads as one line with several changes. */
const CHANGE_MERGE_WINDOW_MS = 5 * 60 * 1000;

const NO_PATIENT_GROUPS: Record<AuditTrailEvent['category'], { key: string; title: string }> = {
  change: { key: '~general', title: 'Registro general' },
  access: { key: '~general', title: 'Registro general' },
  connection: { key: '~connections', title: 'Conexiones' },
  system: { key: '~system', title: 'Sistema' },
};

const emptyCounts = (): AuditTrailCounts => ({
  change: 0,
  access: 0,
  connection: 0,
  system: 0,
  review: 0,
});

export const countAuditTrailEvents = (events: AuditTrailEvent[]): AuditTrailCounts =>
  events.reduce((counts, event) => {
    counts[event.category] += 1;
    if (event.status === 'review') counts.review += 1;
    return counts;
  }, emptyCounts());

const distinct = (values: (string | undefined)[]): number =>
  new Set(values.filter((value): value is string => Boolean(value))).size;

const joinDistinct = (values: (string | undefined)[]): string | undefined => {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return unique.length > 0 ? unique.slice(0, 3).join(', ') : undefined;
};

const buildGroup = (
  key: string,
  grouping: AuditTrailGrouping,
  title: string,
  events: AuditTrailEvent[],
  subtitle?: string,
  session?: AuditTrailSession
): AuditTrailGroup => {
  const newestFirst = [...events].sort((a, b) => b.at - a.at);
  return {
    key,
    grouping,
    title,
    subtitle,
    from: newestFirst[newestFirst.length - 1]?.at ?? session?.startedAt ?? 0,
    to: newestFirst[0]?.at ?? session?.lastSeenAt ?? 0,
    events: newestFirst,
    counts: countAuditTrailEvents(newestFirst),
    patientCount: distinct(newestFirst.map(event => event.patient?.key)),
    actorCount: distinct(newestFirst.map(event => event.actor.key)),
    session,
  };
};

const bucket = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const buckets = new Map<string, T[]>();
  items.forEach(item => {
    const key = keyOf(item);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  });
  return buckets;
};

const byLatestActivity = (a: AuditTrailGroup, b: AuditTrailGroup): number => {
  const aSpecial = a.key.startsWith('~');
  const bSpecial = b.key.startsWith('~');
  if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
  return b.to - a.to;
};

const groupByPatient = (events: AuditTrailEvent[]): AuditTrailGroup[] =>
  [
    ...bucket(
      events,
      event => event.patient?.key ?? NO_PATIENT_GROUPS[event.category].key
    ).entries(),
  ]
    .map(([key, groupEvents]) => {
      const patient = groupEvents.find(event => event.patient)?.patient;
      if (!patient) {
        const title = NO_PATIENT_GROUPS[groupEvents[0].category].title;
        return buildGroup(key, 'patient', title, groupEvents);
      }
      const document =
        groupEvents.find(event => event.patient?.document && !event.patient.document.includes('*'))
          ?.patient?.document ?? patient.document;
      const beds = joinDistinct(groupEvents.map(event => event.patient?.bedId));
      return buildGroup(
        key,
        'patient',
        patient.name,
        groupEvents,
        [document, beds].filter(Boolean).join(' · ') || undefined
      );
    })
    .sort(byLatestActivity);

const groupByActor = (events: AuditTrailEvent[]): AuditTrailGroup[] =>
  [...bucket(events, event => event.actor.key).entries()]
    .map(([key, groupEvents]) =>
      buildGroup(key, 'actor', groupEvents[0].actor.name, groupEvents, groupEvents[0].actor.email)
    )
    .sort(byLatestActivity);

const groupBySession = (
  events: AuditTrailEvent[],
  sessions: AuditTrailSession[]
): AuditTrailGroup[] => {
  const sessionIds = new Set(sessions.map(session => session.id));
  const visibleBySession = bucket(
    events.filter(event => event.sessionId && sessionIds.has(event.sessionId)),
    event => event.sessionId as string
  );
  const groups = sessions.map(session =>
    buildGroup(
      session.id,
      'session',
      session.actor.name,
      visibleBySession.get(session.id) ?? [],
      [session.device, session.ipAddress].filter(Boolean).join(' · ') || undefined,
      session
    )
  );
  const withoutSession = events.filter(
    event => !event.sessionId || !sessionIds.has(event.sessionId)
  );
  if (withoutSession.length > 0) {
    groups.push(buildGroup('~no-session', 'session', 'Sin conexión registrada', withoutSession));
  }
  return groups;
};

const groupByDay = (events: AuditTrailEvent[]): AuditTrailGroup[] =>
  [...bucket(events, event => getClinicalCalendarDateISO(new Date(event.at))).entries()]
    .map(([day, groupEvents]) =>
      buildGroup(day, 'time', formatClinicalDayMonthYear(day), groupEvents)
    )
    .sort((a, b) => b.key.localeCompare(a.key));

export const buildAuditTrailGroups = (
  events: AuditTrailEvent[],
  grouping: AuditTrailGrouping,
  sessions: AuditTrailSession[] = []
): AuditTrailGroup[] => {
  switch (grouping) {
    case 'patient':
      return groupByPatient(events);
    case 'actor':
      return groupByActor(events);
    case 'session':
      return groupBySession(events, sessions);
    case 'time':
      return groupByDay(events);
  }
};

const canMerge = (line: AuditTrailLine, event: AuditTrailEvent): boolean => {
  const last = line.events[line.events.length - 1];
  if (last.actor.key !== event.actor.key) return false;
  if (last.patient?.key !== event.patient?.key) return false;
  if (last.category !== event.category) return false;
  const gap = Math.abs(last.at - event.at);
  if (event.category === 'access') {
    return last.action === event.action && gap <= ACCESS_MERGE_WINDOW_MS;
  }
  if (event.category === 'change') {
    return (
      Boolean(event.patient) &&
      last.area === event.area &&
      last.status === event.status &&
      gap <= CHANGE_MERGE_WINDOW_MS
    );
  }
  return false;
};

/** Display lines for one group (newest first): bursts by the same person collapse. */
export const buildAuditTrailLines = (events: AuditTrailEvent[]): AuditTrailLine[] => {
  const lines: AuditTrailLine[] = [];
  events.forEach(event => {
    const current = lines[lines.length - 1];
    if (current && canMerge(current, event)) {
      current.events.push(event);
      current.from = Math.min(current.from, event.at);
      current.to = Math.max(current.to, event.at);
      return;
    }
    lines.push({ key: event.id, events: [event], from: event.at, to: event.at });
  });
  return lines;
};
