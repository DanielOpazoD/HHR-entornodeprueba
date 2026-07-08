import type {
  SystemHealthIncidentResolution,
  UserHealthEventSeverity,
  UserHealthRecentEvent,
  UserHealthStatus,
} from '@/services/admin/healthService';
import type { SystemHealthIncidentRow } from './systemHealthIncidentTypes';

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Auth',
  daily_record: 'Censo diario',
  firestore: 'Firestore',
  sync: 'Sync',
  indexeddb: 'IndexedDB',
  integration: 'Integracion',
  export: 'Exportacion',
  backup: 'Backup',
  reminders: 'Recordatorios',
  transfers: 'Traslados',
  clinical_document: 'Documento clinico',
  create_day: 'Crear dia',
  handoff: 'Entrega turno',
  prescription: 'Recetas',
  local_error: 'Error local',
  sync_conflict: 'Conflicto',
  health_snapshot: 'Estado',
};

const SOURCE_LABELS: Record<string, string> = {
  local_error: 'Error local',
  operational: 'Operacional',
  sync_conflict: 'Conflicto',
  health_snapshot: 'Estado',
};

const SYNTHETIC_LOCAL_ERROR_THRESHOLD = 10;

export const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  recovered: 'Recuperado',
  resolved: 'Resuelto',
};

export const toMs = (timestamp: string | undefined): number => {
  const value = Date.parse(timestamp || '');
  return Number.isFinite(value) ? value : 0;
};

export const severityRank = (severity: UserHealthEventSeverity): number => {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
};

export const statusRank = (status: UserHealthRecentEvent['status']): number => {
  if (status === 'open') return 0;
  if (status === 'recovered') return 1;
  return 2;
};

export const labelFor = (
  labels: Record<string, string>,
  value: string | undefined,
  fallback: string
) => (value ? labels[value] || value : fallback);

const buildOriginLabel = (event: UserHealthRecentEvent): string => {
  if (event.module && event.operation) return `${event.module} / ${event.operation}`;
  return event.module || event.operation || labelFor(CATEGORY_LABELS, event.category, 'Sin origen');
};

const buildSyntheticEvent = (
  user: UserHealthStatus,
  id: string,
  message: string,
  category: UserHealthRecentEvent['category'],
  severity: UserHealthEventSeverity,
  timestamp: string,
  metadata: Pick<UserHealthRecentEvent, 'module' | 'operation' | 'action' | 'route'> = {}
): UserHealthRecentEvent => ({
  id: `${user.uid}:${id}`,
  source: category === 'sync_conflict' ? 'sync_conflict' : 'health_snapshot',
  category,
  severity,
  status: 'open',
  timestamp,
  message,
  ...metadata,
});

const buildSyntheticHealthEvents = (user: UserHealthStatus): UserHealthRecentEvent[] => {
  const events: UserHealthRecentEvent[] = [];
  const knownEventTimestamp = user.recentEvents?.[0]?.timestamp;
  const syntheticTimestamp = user.latestOperationalIssueAt || knownEventTimestamp || user.lastSeen;

  if ((user.conflictSyncTasks || 0) > 0) {
    events.push(
      buildSyntheticEvent(
        user,
        'sync-conflicts',
        `${user.conflictSyncTasks} conflicto(s) de sincronizacion pendientes`,
        'sync_conflict',
        'critical',
        syntheticTimestamp,
        {
          module: 'Sincronizacion local',
          operation: 'outbox',
          action: 'Resolver conflicto pendiente',
          route: 'Modulo donde se genero la cola local',
        }
      )
    );
  }

  if (user.failedSyncTasks > 0) {
    events.push(
      buildSyntheticEvent(
        user,
        'failed-sync',
        `${user.failedSyncTasks} sincronizacion(es) fallidas`,
        'sync',
        'critical',
        syntheticTimestamp,
        {
          module: 'Sincronizacion local',
          operation:
            user.latestOperationalOperation || user.operationalTopObservedOperation || 'outbox',
          action: 'Reintentar sincronizacion',
          route: 'Cola local del usuario',
        }
      )
    );
  }

  if (
    user.localErrorCount >= SYNTHETIC_LOCAL_ERROR_THRESHOLD &&
    !(user.recentEvents || []).some(event => event.source === 'local_error')
  ) {
    events.push(
      buildSyntheticEvent(
        user,
        'local-errors',
        `${user.localErrorCount} error(es) locales acumulados sin detalle reciente`,
        'local_error',
        user.localErrorCount >= SYNTHETIC_LOCAL_ERROR_THRESHOLD ? 'critical' : 'warning',
        syntheticTimestamp,
        {
          module: 'Navegador del usuario',
          operation: 'contador_local_acumulado',
          action: 'Limpiar usuario y monitorear si reaparece con detalle',
          route: 'Contador local sin evento granular',
        }
      )
    );
  }

  return events;
};

export const buildSystemHealthIncidentRows = (user: UserHealthStatus): SystemHealthIncidentRow[] =>
  [...(user.recentEvents || []), ...buildSyntheticHealthEvents(user)]
    .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
    .map(event => ({
      id: event.id,
      resolutionKey: `${user.uid}:${event.id}`,
      title: event.message,
      timestamp: event.timestamp,
      source: event.source,
      category: event.category,
      sourceLabel: labelFor(SOURCE_LABELS, event.source, 'Evento'),
      categoryLabel: labelFor(CATEGORY_LABELS, event.category, 'Evento'),
      severity: event.severity,
      status: event.status,
      statusLabel: labelFor(STATUS_LABELS, event.status, 'Abierto'),
      originLabel: buildOriginLabel(event),
      actionLabel: event.action || 'Sin accion registrada',
      routeLabel: event.route || 'Sin ruta registrada',
      userLabel: user.displayName || user.email,
      userUid: user.uid,
      userEmail: user.email,
      details: [
        event.runtimeState ? `runtime: ${event.runtimeState}` : '',
        event.telemetryStatus ? `telemetria: ${event.telemetryStatus}` : '',
        ...(event.issues || []),
        ...(event.contextSummary || []),
      ].filter(Boolean),
    }));

export const resolveSystemHealthIncidentRow = (
  row: SystemHealthIncidentRow,
  resolution?: SystemHealthIncidentResolution
): SystemHealthIncidentRow => {
  if (!resolution || resolution.status !== 'resolved') return row;
  if (resolution.resolvedAt && toMs(row.timestamp) > toMs(resolution.resolvedAt)) return row;
  return {
    ...row,
    status: 'resolved',
    statusLabel: 'Resuelto',
    resolvedAt: resolution.resolvedAt,
    resolvedByName: resolution.resolvedByName,
    resolutionNote: resolution.note,
    resolutionHistory: resolution.history,
    details: [
      ...row.details,
      resolution.resolvedAt ? `resuelto: ${resolution.resolvedAt}` : '',
      resolution.resolvedByName ? `por: ${resolution.resolvedByName}` : '',
      resolution.note ? `nota: ${resolution.note}` : '',
    ].filter(Boolean),
  };
};
