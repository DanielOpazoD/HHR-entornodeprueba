import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

const STORAGE_KEY = 'hhr_cudyr_indicator_sync_v1';
let remembered: { scope: string; day: string; months: Record<string, string> } | undefined;

/** First finished sync per month/day, retained across remounts and a tab reload. No clinical data. */
export const cudyrIndicatorFirstSync = (
  scope: string,
  month: string,
  day: string,
  completedAt: string
) => {
  const valid = (value: string) =>
    Number.isFinite(Date.parse(value)) && getClinicalCalendarDateISO(new Date(value)) === day;
  if (!scope) return '';
  if (remembered?.scope !== scope || remembered.day !== day) {
    remembered = { scope, day, months: {} };
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (
        saved?.scope === scope &&
        saved.day === day &&
        saved.months &&
        typeof saved.months === 'object' &&
        !Array.isArray(saved.months)
      ) {
        for (const [key, value] of Object.entries(saved.months).slice(-12))
          if (/^\d{4}-\d{2}$/.test(key) && typeof value === 'string' && valid(value))
            remembered.months[key] = value;
      }
    } catch {
      /* Storage is optional; the in-memory stamp still avoids repeated refreshes. */
    }
  }
  if (!remembered.months[month] && valid(completedAt)) {
    remembered.months[month] = completedAt;
    if (Object.keys(remembered.months).length > 12)
      delete remembered.months[Object.keys(remembered.months)[0]];
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
    } catch {
      /* Quota failures do not block the indicator. */
    }
  }
  return remembered.months[month] || '';
};
