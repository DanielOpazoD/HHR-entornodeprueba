import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  resolveClinicalExplorerNeighbour,
  type ClinicalExplorerPatient,
} from '@/features/census/controllers/clinicalExplorerController';
import { selectClinicalExplorerBed } from './clinicalExplorerStore';
import { ClinicalExplorerHeader } from './ClinicalExplorerHeader';
import { ClinicalExplorerNotes } from './ClinicalExplorerNotes';
import { ClinicalExplorerPatientPanel } from './ClinicalExplorerPatientPanel';
import { EXPLORER_TABS, type ClinicalExplorerTab } from './clinicalExplorerUi';

export interface ClinicalExplorerViewProps {
  censusDate: string;
  bedId: string;
  patients: ClinicalExplorerPatient[];
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.matches('input, textarea, select, [contenteditable="true"]');

/**
 * Body of the consultation mode. The census stays mounted and hidden behind it, so returning
 * restores the same date, filters, position and pending edits; the way back is the
 * ClinicalExplorerBar rendered by the census above this online-only chunk.
 */
export const ClinicalExplorerView: React.FC<ClinicalExplorerViewProps> = ({
  censusDate,
  bedId,
  patients,
}) => {
  const [tab, setTab] = useState<ClinicalExplorerTab>('all');
  const index = patients.findIndex(patient => patient.bedId === bedId);
  const patient = index >= 0 ? patients[index] : null;
  const previousBedId = resolveClinicalExplorerNeighbour(patients, bedId, -1);
  const nextBedId = resolveClinicalExplorerNeighbour(patients, bedId, 1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Dialogs opened from here (requests, documents) own the keyboard while they are open.
      if (document.querySelector('[role="dialog"]') || isTypingTarget(event.target)) return;
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
  }, [patients, bedId]);

  return (
    <div data-testid="clinical-explorer" className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
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
  );
};
