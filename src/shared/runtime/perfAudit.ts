import { isPerfAuditEnabled } from './perfAuditEnabled';
import { recordStartupMilestone } from './censusStartupPerf';
type PerfMarkEntry = {
  name: string;
  t: number;
  count: number;
};

let reportRevision = 0;
const FALLBACK_FLUSH_MS = 8_000;

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

export const markPerf = (name: string, _detail?: string): void => {
  if (!isPerfAuditEnabled() || !isPerformanceSupported()) {
    return;
  }

  if (!/^[a-z][a-z0-9:-]{0,63}$/.test(name)) return;
  recordStartupMilestone(name);
  const existing = state.marks.find(mark => mark.name === name);
  if (existing) {
    existing.count += 1;
    state.reportedMarkCount = -1;
    return;
  }

  if (state.marks.length >= 128) return;
  const t = performance.now();
  state.marks.push({ name, t, count: 1 });

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

export const flushPerfReport = async (trigger: string): Promise<void> => {
  if (
    state.marks.length <= state.reportedMarkCount ||
    !isPerfAuditEnabled() ||
    !isPerformanceSupported()
  ) {
    return;
  }

  state.reportedMarkCount = state.marks.length;
  const marks = state.marks.map(({ name, t, count }) => ({ name, t, count }));
  const revision = ++reportRevision;
  try {
    const { formatPerfReport } = await import('./perfAuditReport');
    if (revision !== reportRevision || !isPerfAuditEnabled()) return;
    const report = formatPerfReport(marks, trigger, getNavigationTiming());
    (window as Window & { __HHR_BOOTSTRAP_PERF_REPORT__?: string }).__HHR_BOOTSTRAP_PERF_REPORT__ =
      report;
    // eslint-disable-next-line no-console
    console.info(report);
  } catch {
    // A diagnostic chunk failure must not block the app or trigger recovery.
  }
};
