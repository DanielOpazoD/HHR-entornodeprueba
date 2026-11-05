import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Compass, Lock } from 'lucide-react';
import {
  resolveClinicalExplorerNeighbour,
  type ClinicalExplorerPatient,
} from '@/features/census/controllers/clinicalExplorerController';
import { formatCalendarDate, formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { closeClinicalExplorer, selectClinicalExplorerBed } from './clinicalExplorerStore';
import { ClinicalExplorerHeader } from './ClinicalExplorerHeader';
import { ClinicalExplorerNotes } from './ClinicalExplorerNotes';
import { ClinicalExplorerPatientPanel } from './ClinicalExplorerPatientPanel';
import { EXPLORER_TABS, type ClinicalExplorerTab } from './clinicalExplorerUi';

export interface ClinicalExplorerViewProps {
  censusDate: string;
  bedId: string;
  patients: ClinicalExplorerPatient[];
  marginStyle: CSSProperties;
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.matches('input, textarea, select, [contenteditable="true"]');

/**
 * Consultation mode inside the census day. The census stays mounted and hidden behind it, so
 * returning restores the same date, filters, position and pending edits.
 */
export const ClinicalExplorerView: React.FC<ClinicalExplorerViewProps> = ({
  censusDate,
  bedId,
  patients,
  marginStyle,
}) => {
  const [tab, setTab] = useState<ClinicalExplorerTab>('all');
  const backRef = useRef<HTMLButtonElement>(null);
  const index = patients.findIndex(patient => patient.bedId === bedId);
  const patient = index >= 0 ? patients[index] : null;
  const previousBedId = resolveClinicalExplorerNeighbour(patients, bedId, -1);
  const nextBedId = resolveClinicalExplorerNeighbour(patients, bedId, 1);

  const close = (): void => {
    closeClinicalExplorer();
    // Hand the focus back to the row that opened the explorer, once the census is visible again.
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-testid="clinical-explorer-trigger-${bedId}"]`)
        ?.focus();
    }, 0);
  };

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Dialogs opened from here (requests, documents) own the keyboard while they are open.
      if (document.querySelector('[role="dialog"]') || isTypingTarget(event.target)) return;
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = resolveClinicalExplorerNeighbour(
        patients,
        bedId,
        event.key === 'ArrowLeft' ? -1 : 1
      );
      if (!target) return;
      event.preventDefault();
      selectClinicalExplorerBed(target);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // close() only reads the current bed; the listener is rebound when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, bedId]);

  const longDate =
    formatCalendarDate(censusDate, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }) ?? formatDateDDMMYYYY(censusDate);

  return (
    <section
      aria-label="Explorador clínico"
      data-testid="clinical-explorer"
      className="flex flex-col gap-3"
      style={marginStyle}
    >
      <div className="sticky top-[var(--hhr-chrome-height)] z-30 flex min-h-12 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
        <button
          ref={backRef}
          type="button"
          onClick={close}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-teal-700 px-3.5 text-[12px] font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          <ArrowLeft size={15} aria-hidden="true" />
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

      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        <ClinicalExplorerPatientPanel
          patients={patients}
          selectedBedId={bedId}
          onSelect={selectClinicalExplorerBed}
        />
        <div className="flex min-w-0 flex-col gap-3">
          {patient ? (
            <>
              <ClinicalExplorerHeader
                patient={patient}
                censusDate={censusDate}
                position={{ index, total: patients.length }}
                previousBedId={previousBedId}
                nextBedId={nextBedId}
                onSelect={selectClinicalExplorerBed}
              />
              <div
                role="tablist"
                aria-label="Áreas"
                className="inline-flex gap-0.5 self-start rounded-[10px] bg-slate-100 p-[3px]"
              >
                {EXPLORER_TABS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.key}
                    onClick={() => setTab(item.key)}
                    className={clsx(
                      'h-[30px] rounded-lg px-3 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                      tab === item.key
                        ? 'bg-white text-medical-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div
                className={clsx(
                  'grid gap-3',
                  tab === 'all' && 'xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'
                )}
              >
                <ClinicalExplorerNotes episodeId={patient.episodeId} tab={tab} onShowAll={setTab} />
              </div>
            </>
          ) : (
            <p className="rounded-[10px] border border-slate-200 bg-white px-4 py-6 text-[12px] text-slate-600">
              Este paciente ya no está en el censo del día. Elige otro de la lista o vuelve al
              censo.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
