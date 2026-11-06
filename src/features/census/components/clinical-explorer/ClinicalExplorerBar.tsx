import React, { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Compass, Lock } from 'lucide-react';
import { formatCalendarDate, formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { closeClinicalExplorer, restoreClinicalExplorerFocus } from './clinicalExplorerStore';

interface ClinicalExplorerBarProps {
  censusDate: string;
  bedId: string;
}

/**
 * The way back to the census. It lives in the census chunk, above the online-only explorer, so
 * «Volver al censo» and Escape work while the explorer loads, if it never loads, and once it is
 * open. Dialogs opened from the explorer own the keyboard while they are open.
 */
export const ClinicalExplorerBar: React.FC<ClinicalExplorerBarProps> = ({ censusDate, bedId }) => {
  const backRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((): void => {
    const opener = closeClinicalExplorer();
    // Once the census is visible again, the focus goes back to where the explorer was opened.
    window.setTimeout(() => restoreClinicalExplorerFocus(bedId, opener), 0);
  }, [bedId]);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const longDate =
    formatCalendarDate(censusDate, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }) ?? formatDateDDMMYYYY(censusDate);

  return (
    <div className="sticky top-[var(--hhr-chrome-height)] z-30 flex min-h-10 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-1.5 py-1">
      <button
        ref={backRef}
        type="button"
        onClick={close}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-[12px] font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Volver al censo
      </button>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
        <Lock size={13} aria-hidden="true" className="text-slate-500" />
        Censo del {longDate}
      </span>
      <span className="ml-auto inline-flex items-center gap-2 text-[12px] font-semibold text-[#365d87]">
        <Compass size={15} aria-hidden="true" />
        Explorador clínico
        <span className="rounded-full border border-dashed border-slate-400 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-slate-500">
          Experimental
        </span>
      </span>
    </div>
  );
};
