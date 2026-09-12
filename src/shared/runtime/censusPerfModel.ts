/** Diagnostics only: private context keys never leave the model. No clinical payloads. */
export type AuthPerfBoundary = 'app_button' | 'google_button' | 'credential_received';
export type AuthPerfEvent =
  | 'credential_received'
  | 'authenticated'
  | 'authorized'
  | 'failed'
  | 'cancelled';
export type CensusPerfEvent =
  | 'record_available'
  | 'local_record_available'
  | 'remote_confirmed'
  | 'table_commit'
  | 'table_paint_opportunity';
type Events = Partial<Record<CensusPerfEvent, number>>;
export interface CensusPerfSnapshot {
  schemaVersion: 1;
  navigationId: string;
  environment: 'development' | 'production';
  timeOrigin: number;
  navigationEvents: Record<string, number>;
  visits: Array<{ id: string; startedAt: number; events: Events }>;
  authAttempts: Array<{ id: string; boundary: AuthPerfBoundary; events: Record<string, number> }>;
}
const NAVIGATION_EVENTS = new Set([
  'bootstrap:start',
  'app-module:import-start',
  'app-module:import-done',
  'bootstrap:runtime-ready',
  'app:first-render',
  'auth:ready',
  'auth-shell:mounted',
]);
const VISIT_EVENTS = new Set<CensusPerfEvent>([
  'record_available',
  'local_record_available',
  'remote_confirmed',
  'table_commit',
  'table_paint_opportunity',
]);
const AUTH_EVENTS = new Set<AuthPerfEvent>([
  'credential_received',
  'authenticated',
  'authorized',
  'failed',
  'cancelled',
]);

export function createCensusPerfModel(options: {
  now: () => number;
  id: () => string;
  timeOrigin: number;
  environment: 'development' | 'production';
}) {
  const state: CensusPerfSnapshot = {
    schemaVersion: 1,
    navigationId: options.id(),
    environment: options.environment,
    timeOrigin: options.timeOrigin,
    navigationEvents: {},
    visits: [],
    authAttempts: [],
  };
  let contextKey: string | undefined;
  let activeVisit: CensusPerfSnapshot['visits'][number] | undefined;
  const stamp = (events: Record<string, number | undefined>, name: string) => {
    const t = options.now();
    if (events[name] === undefined && Number.isFinite(t) && t >= 0) events[name] = t;
  };
  const visit = (key: string) => {
    if (contextKey !== key || !activeVisit) {
      contextKey = key;
      activeVisit = { id: options.id(), startedAt: options.now(), events: {} };
      state.visits.push(activeVisit);
      if (state.visits.length > 10) state.visits.shift();
    }
    return activeVisit.id;
  };
  const census = (id: string, event: CensusPerfEvent) => {
    if (activeVisit?.id !== id || !VISIT_EVENTS.has(event)) return;
    // A frame cannot certify a table that was never committed.
    if (event === 'table_paint_opportunity' && activeVisit.events.table_commit === undefined)
      return;
    stamp(activeVisit.events, event);
  };
  const begin = (boundary: AuthPerfBoundary) => {
    contextKey = undefined;
    activeVisit = undefined;
    const attempt = { id: options.id(), boundary, events: {} as Record<string, number> };
    stamp(attempt.events, 'started');
    state.authAttempts.push(attempt);
    if (state.authAttempts.length > 20) state.authAttempts.shift();
    return attempt.id;
  };
  const auth = (id: string | undefined, event: AuthPerfEvent) => {
    const attempt = state.authAttempts.find(a => a.id === id);
    if (!attempt || !AUTH_EVENTS.has(event)) return;
    if (['authorized', 'failed', 'cancelled'].some(e => attempt.events[e] !== undefined)) return;
    stamp(attempt.events, event);
  };
  return {
    visit,
    census,
    begin,
    auth,
    receiveCredential: () => {
      const last = state.authAttempts.at(-1);
      const reusable =
        last?.boundary === 'google_button' &&
        !['credential_received', 'authorized', 'failed', 'cancelled'].some(
          e => last.events[e] !== undefined
        );
      const id = reusable ? last.id : begin('credential_received');
      auth(id, 'credential_received');
      return id;
    },
    remote: (key: string, fromCache: boolean, pending: boolean, exists: boolean) => {
      if (key === contextKey && activeVisit && fromCache === false && pending === false && exists) {
        census(activeVisit.id, 'remote_confirmed');
      }
    },
    navigation: (name: string) => {
      if (NAVIGATION_EVENTS.has(name)) stamp(state.navigationEvents, name);
    },
    // Detached copy: readers cannot mutate the recorder. No raw keys, URLs or credentials.
    snapshot: (): CensusPerfSnapshot => JSON.parse(JSON.stringify(state)) as CensusPerfSnapshot,
  };
}
