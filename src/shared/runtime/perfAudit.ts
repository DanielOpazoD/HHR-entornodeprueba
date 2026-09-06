type PerfMarkEntry = {
  name: string;
  t: number;
  detail?: string;
  count: number;
};

const PERF_AUDIT_TAG = '[HHR-PERF]';
const FALLBACK_FLUSH_MS = 8_000;

const isPerfAuditEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (import.meta.env.MODE === 'test') {
    return false;
  }

  if (import.meta.env.DEV) {
    return true;
  }

  try {
    return window.localStorage.getItem('hhr_perf_audit') === '1';
  } catch {
    return false;
  }
};

const isPerformanceSupported = (): boolean =>
  typeof performance !== 'undefined' && typeof performance.now === 'function';

const state: {
  marks: PerfMarkEntry[];
  start: number;
  reportedMarkCount: number;
  flushScheduled: boolean;
} = {
  marks: [],
  start: isPerformanceSupported() ? performance.now() : 0,
  reportedMarkCount: 0,
  flushScheduled: false,
};

const ensureFallbackFlush = () => {
  if (state.flushScheduled || typeof window === 'undefined' || !isPerfAuditEnabled()) {
    return;
  }

  state.flushScheduled = true;
  window.setTimeout(
    () => flushPerfReport(`fallback-timeout@${FALLBACK_FLUSH_MS}ms`),
    FALLBACK_FLUSH_MS
  );
};

export const markPerf = (name: string, detail?: string): void => {
  if (!isPerfAuditEnabled() || !isPerformanceSupported()) {
    return;
  }

  const existing = state.marks.find(mark => mark.name === name);
  if (existing) {
    existing.count += 1;
    state.reportedMarkCount = -1;
    return;
  }

  const t = performance.now();
  state.marks.push({ name, t, detail, count: 1 });

  try {
    performance.mark(name);
  } catch {
    // Browser support for named marks is best-effort; the in-memory report is authoritative here.
  }

  ensureFallbackFlush();
};

const getNavigationTiming = (): PerformanceNavigationTiming | undefined => {
  try {
    const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entries[0];
  } catch {
    return undefined;
  }
};

export const flushPerfReport = (trigger: string): void => {
  if (
    state.marks.length <= state.reportedMarkCount ||
    !isPerfAuditEnabled() ||
    !isPerformanceSupported()
  ) {
    return;
  }

  state.reportedMarkCount = state.marks.length;
  const startAt = state.marks[0]?.t ?? state.start;
  const nav = getNavigationTiming();
  const byName = new Map(state.marks.map(mark => [mark.name, mark.t]));
  const lines: string[] = [];

  lines.push(`${PERF_AUDIT_TAG} ----- REPORT (${trigger}) -----`);
  lines.push(`${PERF_AUDIT_TAG} path: ${window.location.pathname}${window.location.search}`);

  if (nav) {
    lines.push(`${PERF_AUDIT_TAG} domContentLoaded: ${nav.domContentLoadedEventEnd.toFixed(1)} ms`);
    lines.push(`${PERF_AUDIT_TAG} load: ${nav.loadEventEnd.toFixed(1)} ms`);
  }

  lines.push(`${PERF_AUDIT_TAG} --- marks, ms desde primera marca ---`);
  for (const mark of state.marks) {
    const detail = mark.detail ? ` (${mark.detail})` : '';
    lines.push(
      `${PERF_AUDIT_TAG} ${mark.name.padEnd(40)} ${(mark.t - startAt)
        .toFixed(1)
        .padStart(8)} ms${detail} · ejecuciones=${mark.count}`
    );
  }

  const delta = (from: string, to: string, label: string) => {
    const a = byName.get(from);
    const b = byName.get(to);
    if (a == null || b == null) {
      return;
    }

    lines.push(`${PERF_AUDIT_TAG} ${label.padEnd(40)} ${(b - a).toFixed(1).padStart(8)} ms`);
  };

  lines.push(`${PERF_AUDIT_TAG} --- deltas ---`);
  delta('bootstrap:start', 'bootstrap:runtime-ready', 'firebase/runtime bootstrap');
  delta('bootstrap:start', 'app-module:import-done', 'App chunk/import');
  delta('bootstrap:runtime-ready', 'app:first-render', 'runtime -> first React render');
  delta('app:first-render', 'auth-bootstrap:effect-start', 'first render -> auth effect');
  delta(
    'auth-bootstrap:redirect-start',
    'auth-bootstrap:redirect-done',
    'redirect auth resolution'
  );
  delta(
    'auth-bootstrap:current-session-start',
    'auth-bootstrap:current-session-done',
    'current session resolution'
  );
  delta(
    'auth-current:runtime-ready-wait-start',
    'auth-current:runtime-ready-done',
    'current auth runtime wait'
  );
  delta(
    'auth-current:role-resolution-start',
    'auth-current:role-resolution-done',
    'current role resolution'
  );
  delta('auth-role:lookup-start', 'auth-role:lookup-done', 'role callable lookup');
  delta('auth-login:click', 'auth-session:user-event', 'Google interaction');
  delta('auth-session:user-event', 'auth-role:lookup-done', 'post-Google role validation');
  delta('auth-login:click', 'auth:ready', 'login click -> authenticated app');
  delta('auth-login:click', 'daily-record:ready', 'login click -> daily data');
  delta(
    'auth-bootstrap:observer-subscribe',
    'auth-bootstrap:observer-event',
    'observer subscribe -> event'
  );
  delta(
    'auth-session:role-resolution-start',
    'auth-session:role-resolution-done',
    'observer role resolution'
  );
  delta('auth-bootstrap:apply-session', 'auth:ready', 'apply session -> auth ready');
  delta('app:first-render', 'auth:ready', 'first render -> auth ready');
  delta('auth:ready', 'auth-shell:mounted', 'auth ready -> shell mounted');
  delta('auth-shell:mounted', 'daily-record:ready', 'shell -> daily record ready');
  delta('bootstrap:start', 'daily-record:ready', 'TOTAL bootstrap -> daily data');

  const report = lines.join('\n');
  (window as Window & { __HHR_BOOTSTRAP_PERF_REPORT__?: string }).__HHR_BOOTSTRAP_PERF_REPORT__ =
    report;

  // eslint-disable-next-line no-console
  console.info(report);
};
