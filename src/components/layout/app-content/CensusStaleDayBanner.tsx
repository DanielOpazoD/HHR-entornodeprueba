import React from 'react';
import { CalendarClock } from 'lucide-react';

import { formatDateForDisplay } from '@/utils/dateDisplayUtils';

const parseLocalDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
};

interface CensusStaleDayBannerProps {
  /** The day currently being viewed (YYYY-MM-DD). */
  currentDateString: string;
  /** Active clinical day (YYYY-MM-DD, 08:00/09:00 shift rollover). */
  clinicalToday: string;
  /** Jump the selection back to the clinical day. */
  onGoToToday: () => void;
}

/**
 * Thin "third bar" that sits directly under the date strip (the white bar) whenever
 * the census is parked on a day other than the clinical "today" — a continuous,
 * non-modal cue in smaller type. Renders nothing when already on the clinical day, so
 * the night shift working its own clinical day before the rollover never sees it.
 *
 * Sticky offset 96px = navbar (56) + date strip (40); z below the date strip's z-40.
 */
export const CensusStaleDayBanner: React.FC<CensusStaleDayBannerProps> = ({
  currentDateString,
  clinicalToday,
  onGoToToday,
}) => {
  if (!clinicalToday || currentDateString === clinicalToday) {
    return null;
  }

  const viewedLabel = formatDateForDisplay(parseLocalDate(currentDateString));
  const todayLabel = formatDateForDisplay(parseLocalDate(clinicalToday));

  return (
    <div
      role="alert"
      className="sticky top-[96px] z-30 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1 text-slate-600 print:hidden"
    >
      <CalendarClock size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
      <p className="flex-1 text-[11px] leading-tight">
        Estás viendo el <span className="font-semibold">{viewedLabel}</span>. El día de hoy es{' '}
        <span className="font-semibold">{todayLabel}</span>.
      </p>
      <button
        onClick={onGoToToday}
        aria-label="Ir a hoy"
        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
      >
        Ir a hoy
      </button>
    </div>
  );
};
