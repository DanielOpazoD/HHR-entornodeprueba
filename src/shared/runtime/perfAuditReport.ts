const PERF_AUDIT_TAG = '[HHR-PERF]';
const REPORT_TRIGGERS = new Set([
  'daily-record:record_ready',
  'daily-record:confirmed_empty',
  'fallback-timeout@8000ms',
]);
export function formatPerfReport(
  marks: Array<{ name: string; t: number; count: number }>,
  trigger: string,
  nav?: Pick<PerformanceNavigationTiming, 'domContentLoadedEventEnd' | 'loadEventEnd'>
): string {
  const startAt = marks[0]?.t ?? 0;
  const byName = new Map(marks.map(mark => [mark.name, mark.t]));
  const lines: string[] = [];

  lines.push(
    `${PERF_AUDIT_TAG} ----- REPORT (${REPORT_TRIGGERS.has(trigger) ? trigger : 'diagnostic'}) -----`
  );
  lines.push(
    `${PERF_AUDIT_TAG} path: ${['/', '/census', '/censo'].includes(window.location.pathname) ? window.location.pathname : 'other'}`
  );

  if (nav) {
    lines.push(`${PERF_AUDIT_TAG} domContentLoaded: ${nav.domContentLoadedEventEnd.toFixed(1)} ms`);
    lines.push(`${PERF_AUDIT_TAG} load: ${nav.loadEventEnd.toFixed(1)} ms`);
  }

  lines.push(`${PERF_AUDIT_TAG} --- marks, ms desde primera marca ---`);
  for (const mark of marks) {
    lines.push(
      `${PERF_AUDIT_TAG} ${mark.name.padEnd(40)} ${(mark.t - startAt)
        .toFixed(1)
        .padStart(8)} ms · ejecuciones=${mark.count}`
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

  lines.push(`${PERF_AUDIT_TAG} --- first-observation deltas (not per-attempt login latency) ---`);
  lines.push(`${PERF_AUDIT_TAG} Auth attempts and visible census: window.__HHR_CENSUS_PERF__`);
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

  return lines.join('\n');
}
