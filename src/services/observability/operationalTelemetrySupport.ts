import type {
  OperationalTelemetryCategory,
  OperationalTelemetryEvent,
  OperationalTelemetryStatus,
} from '@/services/observability/operationalTelemetryTypes';
import { isOperationalRuntimeState } from '@/services/observability/operationalRuntimeState';

export const OPERATIONAL_TELEMETRY_STORAGE_KEY = 'operationalTelemetryEvents';
export const OPERATIONAL_TELEMETRY_MAX_EVENTS = 200;
export const OPERATIONAL_TELEMETRY_DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;
export const OBSERVED_OPERATIONAL_STATUSES: OperationalTelemetryStatus[] = [
  'partial',
  'degraded',
  'failed',
];
export const OBSERVED_CATEGORY_ORDER: OperationalTelemetryCategory[] = [
  'sync',
  'indexeddb',
  'clinical_document',
  'create_day',
  'handoff',
  'export',
  'backup',
];

export const canUseOperationalTelemetryLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const normalizeOperationalTelemetryIssues = (issues?: string[]): string[] | undefined => {
  if (!issues || issues.length === 0) return undefined;
  const normalized = issues.map(issue => String(issue).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.slice(0, 5) : undefined;
};

export const sanitizeOperationalTelemetryContext = (
  context?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!context) return undefined;
  const sanitizedEntries = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .slice(0, 12)
    .map(([key, value]) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return [key, value];
      }
      return [key, JSON.stringify(value)];
    });

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : undefined;
};

export const trimOperationalTelemetryEvents = (
  events: OperationalTelemetryEvent[]
): OperationalTelemetryEvent[] => events.slice(-OPERATIONAL_TELEMETRY_MAX_EVENTS);

export const isOperationalTelemetryStatus = (value: unknown): value is OperationalTelemetryStatus =>
  value === 'success' || value === 'partial' || value === 'degraded' || value === 'failed';

export const isOperationalTelemetryCategory = (
  value: unknown
): value is OperationalTelemetryCategory =>
  value === 'auth' ||
  value === 'daily_record' ||
  value === 'firestore' ||
  value === 'sync' ||
  value === 'indexeddb' ||
  value === 'integration' ||
  value === 'export' ||
  value === 'backup' ||
  value === 'reminders' ||
  value === 'transfers' ||
  value === 'clinical_document' ||
  value === 'create_day' ||
  value === 'handoff';

export const sanitizePersistedOperationalTelemetryEvent = (
  value: unknown
): OperationalTelemetryEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<OperationalTelemetryEvent>;
  if (
    !isOperationalTelemetryCategory(event.category) ||
    !isOperationalTelemetryStatus(event.status) ||
    typeof event.operation !== 'string' ||
    event.operation.trim().length === 0 ||
    typeof event.timestamp !== 'string' ||
    Number.isNaN(Date.parse(event.timestamp))
  ) {
    return null;
  }

  return {
    category: event.category,
    status: event.status,
    runtimeState: isOperationalRuntimeState(event.runtimeState) ? event.runtimeState : undefined,
    operation: event.operation,
    timestamp: event.timestamp,
    date: typeof event.date === 'string' ? event.date : undefined,
    issues: Array.isArray(event.issues)
      ? normalizeOperationalTelemetryIssues(event.issues)
      : undefined,
    context:
      event.context && typeof event.context === 'object'
        ? sanitizeOperationalTelemetryContext(event.context as Record<string, unknown>)
        : undefined,
  };
};

export const isObservedOperationalTelemetryStatus = (status: OperationalTelemetryStatus): boolean =>
  OBSERVED_OPERATIONAL_STATUSES.includes(status);

export const createRecordedOperationalTelemetryEvent = (
  input: Omit<OperationalTelemetryEvent, 'timestamp'>
): OperationalTelemetryEvent => ({
  ...input,
  timestamp: new Date().toISOString(),
  issues: normalizeOperationalTelemetryIssues(input.issues),
  context: sanitizeOperationalTelemetryContext(input.context),
});

export const buildTopObservedOperationalKey = <T extends string>(values: T[]): T | undefined => {
  if (values.length === 0) return undefined;
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as T | undefined;
};
