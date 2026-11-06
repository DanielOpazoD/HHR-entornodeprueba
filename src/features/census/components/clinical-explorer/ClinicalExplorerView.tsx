import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  clinicalExplorerPatientIdentity,
  listClinicalExplorerExamCandidates,
  resolveClinicalExplorerNeighbour,
  type ClinicalExplorerPatient,
} from '@/features/census/controllers/clinicalExplorerController';
import { selectClinicalExplorerBed } from './clinicalExplorerStore';
import { ClinicalExplorerHeader } from './ClinicalExplorerHeader';
import { ClinicalExplorerImaging } from './ClinicalExplorerImaging';
import { ClinicalExplorerLab } from './ClinicalExplorerLab';
import { ClinicalExplorerVitals } from './ClinicalExplorerVitals';
import { ClinicalExplorerNotes } from './ClinicalExplorerNotes';
import { ClinicalExplorerPatientPanel } from './ClinicalExplorerPatientPanel';
import { EXPLORER_TABS, type ClinicalExplorerTab } from './clinicalExplorerUi';

const LazyExamRequestModal = lazy(() =>
  import('@/components/modals/ExamRequestModal').then(module => ({
    default: module.ExamRequestModal,
  }))
);

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
  // The laboratory request is tied to the patient who opened it, not to the bed on screen: it
  // stays open if that patient moves to another bed and closes only if they leave the census.
  const [examRequestFor, setExamRequestFor] = useState<string | null>(null);
  const examCandidates = useMemo(
    () =>
      listClinicalExplorerExamCandidates(patients).map(candidate => ({
        key: candidate.key,
        label: candidate.label,
        patient: candidate.data,
      })),
    [patients]
  );
  const examOpener = examCandidates.find(candidate => candidate.key === examRequestFor);
  // Leaving the census closes the request for good: it does not reopen if the patient returns.
  if (examRequestFor && !examOpener) setExamRequestFor(null);
  const patient = patients.find(candidate => candidate.bedId === bedId) ?? null;
  const patientKey = patient ? clinicalExplorerPatientIdentity(patient) : null;
  const [indicationSelection, setIndicationSelection] = useState<{
    patientKey: string | null;
    date: string | null;
  }>({ patientKey: null, date: null });
  if (indicationSelection.patientKey !== patientKey) {
    setIndicationSelection({ patientKey, date: null });
  }

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
    <div
      data-testid="clinical-explorer"
      className="grid items-start gap-3 lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-[36px_minmax(0,1fr)]"
    >
      <ClinicalExplorerPatientPanel
        patients={patients}
        selectedBedId={bedId}
        onSelect={selectClinicalExplorerBed}
      />
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        {patient ? (
          <>
            <ClinicalExplorerHeader
              patient={patient}
              onRequestExams={() => setExamRequestFor(clinicalExplorerPatientIdentity(patient))}
              censusDate={censusDate}
              indicationDate={indicationSelection.date}
            />
            <div
              role="tablist"
              aria-label="Áreas"
              className="flex max-w-full gap-x-1 overflow-x-auto border-b border-slate-200"
            >
              {EXPLORER_TABS.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={clsx(
                    'min-h-9 shrink-0 border-b-2 px-2 text-[12px] font-medium sm:px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                    tab === item.key
                      ? 'border-teal-700 text-teal-800'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-800'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              className={clsx(
                'grid items-start gap-3',
                tab === 'all' && 'xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'
              )}
            >
              {(tab === 'all' || tab === 'evolutions' || tab === 'indications') && (
                <ClinicalExplorerNotes
                  key={patientKey}
                  episodeId={patient.episodeId}
                  selectedDate={indicationSelection.date}
                  onSelectDate={date => setIndicationSelection({ patientKey, date })}
                  tab={tab}
                  onShowAll={setTab}
                >
                  {tab === 'all' && (
                    <>
                      <ClinicalExplorerVitals patient={patient} />
                      <div className="min-w-0 xl:col-span-2">
                        <ClinicalExplorerLab
                          patient={patient}
                          censusDate={censusDate}
                          tab={tab}
                          onShowAll={setTab}
                        />
                      </div>
                      <div className="min-w-0 xl:col-span-2">
                        <ClinicalExplorerImaging patient={patient} tab={tab} onShowAll={setTab} />
                      </div>
                    </>
                  )}
                </ClinicalExplorerNotes>
              )}
              {tab === 'vitals' && <ClinicalExplorerVitals patient={patient} />}
              {tab === 'lab' && (
                <ClinicalExplorerLab
                  patient={patient}
                  censusDate={censusDate}
                  tab={tab}
                  onShowAll={setTab}
                />
              )}
              {tab === 'img' && (
                <ClinicalExplorerImaging patient={patient} tab={tab} onShowAll={setTab} />
              )}
            </div>
          </>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-[12px] text-slate-600">
            Este paciente ya no está en el censo del día. Elige otro de la lista o vuelve al censo.
          </p>
        )}
      </div>
      {examOpener && (
        <Suspense fallback={null}>
          <LazyExamRequestModal
            isOpen
            onClose={() => setExamRequestFor(null)}
            patient={examOpener.patient}
            recordDate={censusDate}
            candidates={examCandidates}
            patientKey={examOpener.key}
          />
        </Suspense>
      )}
    </div>
  );
};
