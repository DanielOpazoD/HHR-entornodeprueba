import {
  createCensusPerfModel,
  type AuthPerfBoundary,
  type AuthPerfEvent,
} from './censusPerfModel';
import { isPerfAuditEnabled } from './perfAuditEnabled';

let model: ReturnType<typeof createCensusPerfModel> | undefined;
const getModel = () => {
  if (!isPerfAuditEnabled() || typeof window === 'undefined') return undefined;
  if (!model) {
    model = createCensusPerfModel({
      now: () => performance.now(),
      id: () => crypto.randomUUID(),
      timeOrigin: performance.timeOrigin,
      environment: import.meta.env.DEV ? 'development' : 'production',
    });
    Object.defineProperty(window, '__HHR_CENSUS_PERF__', {
      configurable: true,
      get: () => (isPerfAuditEnabled() ? model?.snapshot() : undefined),
    });
  }
  return model;
};
/** Diagnostics must never turn an otherwise valid clinical operation into a failure. */
function safely<T>(action: (m: NonNullable<typeof model>) => T): T | undefined {
  try {
    const m = getModel();
    return m ? action(m) : undefined;
  } catch {
    return undefined;
  }
}
export const recordStartupMilestone = (name: string) => safely(m => m.navigation(name));
export const beginAuthPerfAttempt = (boundary: AuthPerfBoundary) => safely(m => m.begin(boundary));
export const receiveAuthPerfCredential = () => safely(m => m.receiveCredential());
export const recordAuthPerfEvent = (id: string | undefined, event: AuthPerfEvent) =>
  safely(m => m.auth(id, event));
export const recordCensusAvailability = (key: string, hasRecord: boolean, isLocal: boolean) =>
  safely(m => {
    const id = m.visit(key);
    if (hasRecord) {
      m.census(id, 'record_available');
      if (isLocal) m.census(id, 'local_record_available');
    }
  });
/** Separates the artificial wait before talking to the server from real network latency. */
export const recordCensusRemoteEnabled = (key: string) =>
  safely(m => m.census(m.visit(key), 'remote_enabled'));
export const recordCensusSubscriptionStart = (key: string) =>
  safely(m => m.census(m.visit(key), 'subscription_start'));
export const recordCensusServerSnapshot = (
  key: string,
  fromCache: boolean,
  pending: boolean,
  exists: boolean
) => safely(m => m.remote(key, fromCache, pending, exists));
export const beginCensusTableObservation = (key: string) => safely(m => m.visit(key));
export const recordCensusTableMilestone = (
  id: string,
  event: 'table_commit' | 'table_paint_opportunity'
) =>
  safely(m => {
    // Child effects can precede parent effects when a cached record mounts instantly.
    // This call is only made after the real table/record has been verified.
    if (event === 'table_commit') m.census(id, 'record_available');
    m.census(id, event);
  });
