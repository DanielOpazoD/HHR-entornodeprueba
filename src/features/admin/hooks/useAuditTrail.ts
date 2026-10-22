import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  executeFetchAuditLogRange,
  executeFetchAuditLogsByIds,
} from '@/application/audit/fetchAuditLogsUseCase';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type {
  AuditTrailArea,
  AuditTrailEvent,
  AuditTrailGroup,
  AuditTrailSession,
} from '@/types/auditTrailTypes';
import { AUDIT_TRAIL_CATEGORY_ORDER } from '@/services/admin/auditTrail/auditTrailCatalog';
import { normalizeAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailNormalize';
import {
  buildAuditTrailSessions,
  resolveAuditTrailBoundaryIds,
} from '@/services/admin/auditTrail/auditTrailSessions';
import { buildAuditTrailGroups } from '@/services/admin/auditTrail/auditTrailGroups';
import {
  buildAuditTrailActorOptions,
  filterAuditTrailEvents,
  summarizeAuditTrail,
  type AuditTrailActorOption,
  type AuditTrailSummary,
} from '@/services/admin/auditTrail/auditTrailFilters';
import {
  buildAuditTrailPeriod,
  resolveAuditTrailQueryRange,
  type AuditTrailPeriod,
} from '@/services/admin/auditTrail/auditTrailPeriod';
import {
  AUDIT_TRAIL_VIEW_STORAGE_KEY,
  parseAuditTrailViewPreferences,
  serializeAuditTrailViewPreferences,
  type AuditTrailViewPreferences,
} from '@/services/admin/auditTrail/auditTrailPreferences';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

/** Upper bound per period; the screen says so when it is reached. */
export const AUDIT_TRAIL_FETCH_LIMIT = 3_000;

type AuditTrailLoad =
  | { status: 'loading' }
  /** `boundaryLogs`: starts and ends of connections the period cuts off (not listed as events). */
  | { status: 'ready'; logs: AuditLogEntry[]; boundaryLogs: AuditLogEntry[] }
  | { status: 'error'; message: string };

const LOADING: AuditTrailLoad = { status: 'loading' };

export interface AuditTrailScope {
  search: string;
  actorKey?: string;
  area?: AuditTrailArea;
  reviewOnly: boolean;
}

export interface UseAuditTrailResult {
  period: AuditTrailPeriod;
  setPeriod: (period: AuditTrailPeriod) => void;
  status: AuditTrailLoad['status'];
  errorMessage?: string;
  truncated: boolean;
  refresh: () => void;
  scope: AuditTrailScope;
  updateScope: (patch: Partial<AuditTrailScope>) => void;
  preferences: AuditTrailViewPreferences;
  updatePreferences: (patch: Partial<AuditTrailViewPreferences>) => void;
  /** Events of the period that match search, staff, area and review filters. */
  scopedEvents: AuditTrailEvent[];
  /** Scoped events of the categories shown. */
  visibleEvents: AuditTrailEvent[];
  sessions: AuditTrailSession[];
  groups: AuditTrailGroup[];
  summary: AuditTrailSummary;
  actorOptions: AuditTrailActorOption[];
}

const readStoredPreferences = (): string | null => {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(AUDIT_TRAIL_VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
};

const storePreferences = (preferences: AuditTrailViewPreferences): void => {
  try {
    localStorage.setItem(
      AUDIT_TRAIL_VIEW_STORAGE_KEY,
      serializeAuditTrailViewPreferences(preferences)
    );
  } catch {
    // Preferences are a convenience; the view works without storage.
  }
};

export const useAuditTrail = (): UseAuditTrailResult => {
  const [period, setPeriod] = useState<AuditTrailPeriod>(() =>
    buildAuditTrailPeriod('day', getClinicalCalendarDateISO())
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [scope, setScope] = useState<AuditTrailScope>({ search: '', reviewOnly: false });
  const [preferences, setPreferences] = useState(() =>
    parseAuditTrailViewPreferences(readStoredPreferences())
  );

  // Each period (or refresh) is one request; anything not answered for it yet reads as loading.
  const requestKey = `${period.startDate}|${period.endDate}|${reloadToken}`;
  const [answer, setAnswer] = useState<{ key: string; load: AuditTrailLoad } | null>(null);
  const load: AuditTrailLoad = answer?.key === requestKey ? answer.load : LOADING;

  useEffect(() => {
    let cancelled = false;
    const [startDate, endDate] = requestKey.split('|');
    const loadPeriod = async (): Promise<AuditTrailLoad> => {
      const result = await executeFetchAuditLogRange({
        ...resolveAuditTrailQueryRange({ kind: 'range', startDate, endDate }),
        limit: AUDIT_TRAIL_FETCH_LIMIT,
      });
      if (result.status === 'failed') {
        return {
          status: 'error',
          message: result.issues[0]?.message || 'No se pudo cargar la auditoría.',
        };
      }
      // Without the cut-off starts and ends, those connections fall back to the period's events.
      const boundaryIds = resolveAuditTrailBoundaryIds(result.data);
      const boundary =
        boundaryIds.length > 0
          ? await executeFetchAuditLogsByIds(boundaryIds).catch(() => null)
          : null;
      return {
        status: 'ready',
        logs: result.data,
        boundaryLogs: boundary && boundary.status !== 'failed' ? boundary.data : [],
      };
    };
    void loadPeriod().then(nextLoad => {
      if (!cancelled) setAnswer({ key: requestKey, load: nextLoad });
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const events = useMemo(
    () => (load.status === 'ready' ? normalizeAuditTrailEvents(load.logs) : []),
    [load]
  );
  const sessions = useMemo(
    () =>
      buildAuditTrailSessions(
        load.status === 'ready' ? [...events, ...normalizeAuditTrailEvents(load.boundaryLogs)] : []
      ),
    [events, load]
  );

  const scopedEvents = useMemo(
    () =>
      filterAuditTrailEvents(events, {
        categories: AUDIT_TRAIL_CATEGORY_ORDER,
        areas: scope.area ? [scope.area] : [],
        reviewOnly: scope.reviewOnly,
        actorKey: scope.actorKey,
        search: scope.search,
      }),
    [events, scope]
  );

  const scopedSessions = useMemo(() => {
    const narrowed = Boolean(scope.search.trim() || scope.area || scope.reviewOnly);
    const sessionIds = new Set(scopedEvents.map(event => event.sessionId));
    return sessions.filter(
      session =>
        (!scope.actorKey || session.actor.key === scope.actorKey) &&
        (!narrowed || sessionIds.has(session.id))
    );
  }, [sessions, scopedEvents, scope]);

  // "Revisar" shows every pending event, whatever categories are switched off.
  const visibleEvents = useMemo(
    () =>
      scope.reviewOnly
        ? scopedEvents
        : scopedEvents.filter(event => preferences.categories.includes(event.category)),
    [scopedEvents, preferences.categories, scope.reviewOnly]
  );

  const groups = useMemo(
    () => buildAuditTrailGroups(visibleEvents, preferences.grouping, scopedSessions),
    [visibleEvents, preferences.grouping, scopedSessions]
  );

  const updateScope = useCallback((patch: Partial<AuditTrailScope>) => {
    setScope(current => ({ ...current, ...patch }));
  }, []);

  const updatePreferences = useCallback((patch: Partial<AuditTrailViewPreferences>) => {
    setPreferences(current => {
      const next = { ...current, ...patch };
      storePreferences(next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => setReloadToken(token => token + 1), []);

  return {
    period,
    setPeriod,
    status: load.status,
    errorMessage: load.status === 'error' ? load.message : undefined,
    truncated: load.status === 'ready' && load.logs.length >= AUDIT_TRAIL_FETCH_LIMIT,
    refresh,
    scope,
    updateScope,
    preferences,
    updatePreferences,
    scopedEvents,
    visibleEvents,
    sessions: scopedSessions,
    groups,
    summary: useMemo(
      () => summarizeAuditTrail(scopedEvents, scopedSessions),
      [scopedEvents, scopedSessions]
    ),
    actorOptions: useMemo(() => {
      const options = buildAuditTrailActorOptions(events);
      // A chosen staff member stays selectable after moving to a period without their activity.
      return scope.actorKey && !options.some(option => option.key === scope.actorKey)
        ? [...options, { key: scope.actorKey, name: scope.actorKey, count: 0 }]
        : options;
    }, [events, scope.actorKey]),
  };
};
