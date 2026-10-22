import type {
  AuditTrailArea,
  AuditTrailCategory,
  AuditTrailCounts,
  AuditTrailEvent,
  AuditTrailSession,
} from '@/types/auditTrailTypes';
import { countAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailGroups';
import { normalizeAuditTrailText } from '@/services/admin/auditTrail/auditTrailValues';

export interface AuditTrailFilters {
  /** Visible categories; an empty list shows none. */
  categories: AuditTrailCategory[];
  /** Restricts to these areas; empty means every area. */
  areas: AuditTrailArea[];
  reviewOnly: boolean;
  actorKey?: string;
  search: string;
}

const searchableText = (event: AuditTrailEvent): string =>
  normalizeAuditTrailText(
    [
      event.patient?.name,
      event.patient?.document,
      event.patient?.bedId,
      event.actor.name,
      event.actor.email,
      event.authors,
      event.label,
      event.detail,
      event.ipAddress,
      event.device,
      ...event.changes.flatMap(change => [change.field, change.before, change.after]),
    ]
      .filter(Boolean)
      .join(' ')
  );

/** Document search ignores dots and dashes, so `12345678` finds `12.345.678-9`. */
const compactDocument = (value: string): string => value.replace(/[.\-\s]/g, '');

export const matchesAuditTrailSearch = (event: AuditTrailEvent, search: string): boolean => {
  const terms = normalizeAuditTrailText(search).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const text = searchableText(event);
  const compactText = compactDocument(text);
  return terms.every(term => text.includes(term) || compactText.includes(compactDocument(term)));
};

export const filterAuditTrailEvents = (
  events: AuditTrailEvent[],
  filters: AuditTrailFilters
): AuditTrailEvent[] =>
  events.filter(
    event =>
      filters.categories.includes(event.category) &&
      (filters.areas.length === 0 || filters.areas.includes(event.area)) &&
      (!filters.reviewOnly || event.status === 'review') &&
      (!filters.actorKey || event.actor.key === filters.actorKey) &&
      matchesAuditTrailSearch(event, filters.search)
  );

export interface AuditTrailSummary extends AuditTrailCounts {
  patients: number;
  actors: number;
  sessions: number;
}

export const summarizeAuditTrail = (
  events: AuditTrailEvent[],
  sessions: AuditTrailSession[]
): AuditTrailSummary => ({
  ...countAuditTrailEvents(events),
  patients: new Set(events.map(event => event.patient?.key).filter(Boolean)).size,
  actors: new Set(events.map(event => event.actor.key)).size,
  sessions: sessions.length,
});

export interface AuditTrailActorOption {
  key: string;
  name: string;
  email?: string;
  count: number;
}

/** Staff seen in the period, busiest first, for the "Funcionario" filter. */
export const buildAuditTrailActorOptions = (events: AuditTrailEvent[]): AuditTrailActorOption[] => {
  const options = new Map<string, AuditTrailActorOption>();
  events.forEach(event => {
    const option = options.get(event.actor.key) ?? {
      key: event.actor.key,
      name: event.actor.name,
      email: event.actor.email,
      count: 0,
    };
    option.count += 1;
    options.set(event.actor.key, option);
  });
  return [...options.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es')
  );
};
