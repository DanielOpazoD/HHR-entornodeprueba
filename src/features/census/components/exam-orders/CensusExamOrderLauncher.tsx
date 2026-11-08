import React, { lazy, Suspense, useEffect, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import type { ExamRequestCandidate } from '@/hooks/useExamRequestOrders';
import {
  clearExamOrderSelection,
  EXAM_ORDER_NAME_ATTRIBUTE,
  useExamOrderSelection,
} from './examOrderSelectionStore';

const LazyExamRequestModal = lazy(() =>
  import('@/components/modals/ExamRequestModal').then(module => ({
    default: module.ExamRequestModal,
  }))
);

interface CensusExamOrderLauncherProps {
  censusDate: string;
  candidates: ExamRequestCandidate[];
}

const BAR_ATTRIBUTE = 'data-exam-order-bar';

/**
 * The census patients chosen with Shift + click on their names: a floating button opens one
 * laboratory request with a tab each. Floating, so the header and rows never move. Escape or a
 * click anywhere else clears the choice; opening the request also clears it.
 */
export const CensusExamOrderLauncher: React.FC<CensusExamOrderLauncherProps> = ({
  censusDate,
  candidates,
}) => {
  const chosen = useExamOrderSelection(censusDate);
  // A patient who left the census is no longer chosen.
  const selected = chosen.filter(key => candidates.some(candidate => candidate.key === key));
  const [openKeys, setOpenKeys] = useState<readonly string[] | null>(null);
  const openOrders = openKeys?.filter(key => candidates.some(candidate => candidate.key === key));
  const opener = candidates.find(candidate => candidate.key === openOrders?.[0]);
  // Everyone in the request left the census: nothing is left to print.
  if (openKeys && !opener) setOpenKeys(null);
  const hasSelection = selected.length > 0;

  useEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearExamOrderSelection();
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${BAR_ATTRIBUTE}]`)) return;
      if (event.shiftKey && target?.closest(`[${EXAM_ORDER_NAME_ATTRIBUTE}]`)) return;
      clearExamOrderSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [hasSelection]);

  // Leaving the census leaves nothing chosen behind.
  useEffect(() => () => clearExamOrderSelection(), []);

  const openRequest = () => {
    setOpenKeys(selected);
    clearExamOrderSelection();
  };

  return (
    <>
      {hasSelection && (
        <div
          {...{ [BAR_ATTRIBUTE]: '' }}
          role="region"
          aria-label="Pacientes elegidos para orden de exámenes"
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2 shadow-lg shadow-emerald-900/10 print:hidden"
        >
          <span aria-live="polite" className="text-[12px] font-medium text-slate-600">
            {selected.length === 1 ? '1 paciente' : `${selected.length} pacientes`}
          </span>
          <button
            type="button"
            onClick={openRequest}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-md shadow-emerald-600/25 hover:from-emerald-600 hover:to-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <FlaskConical size={14} aria-hidden="true" />
            Orden de exámenes
          </button>
          <button
            type="button"
            onClick={clearExamOrderSelection}
            aria-label="Quitar la selección"
            title="Quitar la selección (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {opener && openOrders && (
        <Suspense fallback={null}>
          <LazyExamRequestModal
            isOpen
            onClose={() => setOpenKeys(null)}
            patient={opener.patient}
            recordDate={censusDate}
            candidates={candidates}
            patientKey={opener.key}
            alsoInclude={openOrders}
          />
        </Suspense>
      )}
    </>
  );
};
