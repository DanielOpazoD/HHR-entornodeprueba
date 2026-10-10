import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

type CachedReport = CudyrReportDataset & { cacheVerificationRequired?: boolean };

const STORAGE_KEY = 'hhr_cudyr_report_cache_v11';
const caches = new WeakMap<object, { scope: string; reports: Map<string, CachedReport> }>();
const key = (from: string, to: string) => `${from}:${to}`;

/** Session-owned read cache. Firebase remains authoritative; browser storage is expendable. */
export const cudyrReportCache = (owner: object, scope: string, persist: boolean) => {
  let entry = caches.get(owner);
  if (!entry || entry.scope !== scope) {
    entry = { scope, reports: new Map() };
    caches.set(owner, entry);
    if (persist) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (saved?.scope === scope && Array.isArray(saved.reports)) {
          for (const report of saved.reports) {
            if (
              report?.schemaVersion === 1 &&
              typeof report.from === 'string' &&
              typeof report.to === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/.test(report.from) &&
              /^\d{4}-\d{2}-\d{2}$/.test(report.to) &&
              Number.isFinite(Date.parse(report.loadedAt || report.generatedAt)) &&
              Array.isArray(report.rows) &&
              Array.isArray(report.coverage) &&
              Array.isArray(report.captures) &&
              Array.isArray(report.observations) &&
              Array.isArray(report.issues) &&
              Array.isArray(report.corrections) &&
              Array.isArray(report.dischargeAudit) &&
              [report.rows, report.coverage, report.captures, report.observations].every(entries =>
                entries.every((item: unknown) => item && typeof item === 'object')
              )
            ) {
              entry.reports.set(key(report.from, report.to), report);
            }
          }
        }
      } catch {
        /* An unavailable or invalid local cache must not block Firebase reads. */
      }
    }
  }
  const reports = entry.reports;
  const save = () => {
    if (!persist) return;
    try {
      const recent = [...reports.values()].slice(-4);
      let serialized = JSON.stringify({ scope, reports: recent });
      // A reconstructed month can exceed one million characters; retain it within a bounded
      // browser-storage budget instead of silently discarding the only monthly snapshot.
      while (serialized.length > 2_300_000 && recent.length) {
        recent.shift();
        serialized = JSON.stringify({ scope, reports: recent });
      }
      sessionStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      /* Quota failures leave the in-memory cache usable. */
    }
  };
  return {
    get(from: string, to: string): CachedReport | undefined {
      const report =
        reports.get(key(from, to)) ||
        [...reports.values()].find(r => r.from === from && r.to >= to && r.issues.length === 0);
      if (!report) return undefined;
      const rows = report.rows.filter(row => row.date >= from && row.date <= to);
      const episodes = new Set(rows.map(row => row.clinicalEpisodeId));
      return {
        ...report,
        from,
        to,
        loadedAt: report.loadedAt || report.generatedAt,
        observations: report.observations.filter(
          item => item.censusDate >= from && item.censusDate <= to
        ),
        captures: report.captures.filter(item => episodes.has(item.capture.clinicalEpisodeId)),
        corrections: report.corrections.filter(item => episodes.has(item.clinicalEpisodeId)),
        dischargeAudit: report.dischargeAudit.filter(item => episodes.has(item.clinicalEpisodeId)),
        exclusions: report.exclusions?.filter(item => item.date >= from && item.date <= to),
        coverage: report.coverage.filter(day => day.date >= from && day.date <= to),
        rows,
      };
    },
    put(report: CudyrReportDataset) {
      if (report.issues.length || report.coverage.some(day => day.state === 'error')) return;
      // A derived official prefix must not evict its reusable full-month projection.
      const full =
        report.officialSnapshot &&
        [...reports.values()].find(
          existing =>
            existing.from === report.from &&
            existing.to > report.to &&
            existing.officialSnapshot?.version === report.officialSnapshot?.version
        );
      if (full) {
        reports.set(key(full.from, full.to), {
          ...full,
          loadedAt: report.loadedAt || full.loadedAt,
          cacheVerificationRequired: false,
        });
        save();
        return;
      }
      // A larger monthly range supersedes its cached prefixes.
      for (const [id, existing] of reports)
        if (existing.from === report.from && existing.to <= report.to) reports.delete(id);
      reports.set(key(report.from, report.to), { ...report, cacheVerificationRequired: false });
      while (reports.size > 12) reports.delete(reports.keys().next().value!);
      save();
    },
    requireVerification() {
      for (const [id, report] of reports)
        reports.set(id, { ...report, cacheVerificationRequired: true });
      save();
    },
    clear() {
      reports.clear();
      save();
    },
    hasDifferentRevision(date: string, version: string) {
      return [...reports.values()].some(report =>
        report.coverage.some(day => day.date === date && day.recordVersion !== version)
      );
    },
  };
};
