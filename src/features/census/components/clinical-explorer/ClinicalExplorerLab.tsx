import React, { Suspense, useId, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { parseDateDDMMYYYY } from '@/features/laboratory';
import { ChevronDown, FlaskConical } from 'lucide-react';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { useSyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { ClinicalExplorerLabTable } from './ClinicalExplorerLabTable';
import {
  AreaCard,
  EmptyNote,
  LinkButton,
  ReadFailure,
  SkeletonLines,
  type ClinicalExplorerTab,
} from './clinicalExplorerUi';

interface ClinicalExplorerLabProps {
  patient: ClinicalExplorerPatient;
  censusDate: string;
  tab: ClinicalExplorerTab;
  onShowAll: (tab: ClinicalExplorerTab) => void;
}

const LabTrends = lazyWithRetry(() =>
  import('./ClinicalExplorerLabTrends').then(module => ({
    default: module.ClinicalExplorerLabTrends,
  }))
);

interface LabSelection {
  scope: string;
  day: string | null;
  trends: 'unopened' | 'open' | 'closed';
}

/** Syslab reports of the hospitalization: ten recent source reports followed by trends per variable. */
export const ClinicalExplorerLab: React.FC<ClinicalExplorerLabProps> = ({
  patient,
  censusDate,
  tab,
  onShowAll,
}) => {
  const expanded = tab === 'lab';
  const identity = `${patient.data.rut.trim()}:${patient.episodeId}`;
  const lab = useSyslabHospitalizationReports({
    rut: patient.data.rut.trim(),
    episodeId: patient.episodeId,
    admissionDate: patient.data.admissionDate,
    enabled: true,
  });
  const epoch = useSessionEpoch();
  const scope = `${epoch}:${identity}`;
  const trendsId = useId();
  const days = useMemo(
    () => [...new Set(lab.exams.map(exam => parseDateDDMMYYYY(exam.date)))].sort(),
    [lab.exams]
  );
  const initial: LabSelection = { scope, day: null, trends: 'unopened' };
  const [stored, setSelection] = useState<LabSelection>(initial);
  if (stored.scope !== scope) setSelection(initial);
  const selection = stored.scope === scope ? stored : initial;
  const day =
    selection.day && days.includes(selection.day) ? selection.day : (days[days.length - 1] ?? null);
  const dayIndex = day ? days.indexOf(day) : -1;
  const selectDay = (next: string | undefined): void => {
    if (next) setSelection({ ...selection, day: next });
  };

  const subtitle =
    lab.phase === 'ready' || lab.phase === 'empty'
      ? `${lab.exams.length} ${lab.exams.length === 1 ? 'informe' : 'informes'}${
          lab.pending ? ` · ${lab.pending} sin resultado aún` : ''
        }`
      : undefined;

  const body = (): React.ReactNode => {
    switch (lab.phase) {
      case 'checking':
      case 'listing':
        return <SkeletonLines label="Consultando Syslab" />;
      case 'reading':
        return (
          <p role="status" className="text-[12px] text-slate-500">
            {lab.progress?.status === 'queued' ? 'En cola del Mac mini' : 'Leyendo informes'}
            {lab.progress ? ` · ${lab.progress.completed} de ${lab.progress.total}` : '…'}
          </p>
        );
      case 'login-required':
        return (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span>Syslab pide iniciar sesión.</span>
            <button
              type="button"
              onClick={() => void lab.access.openLogin()}
              disabled={lab.access.isOpening || lab.access.isAwaitingLogin}
              className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60"
            >
              {lab.access.isAwaitingLogin ? 'Esperando el acceso…' : 'Iniciar sesión en Syslab'}
            </button>
          </p>
        );
      case 'unavailable':
      case 'error':
        return (
          <ReadFailure
            summary="No se pudo leer el laboratorio."
            message={lab.message}
            onRetry={lab.retry}
          />
        );
      case 'empty':
        return <EmptyNote>Sin informes de laboratorio en esta hospitalización.</EmptyNote>;
      case 'ready':
        break;
    }
    if (!lab.analysis) return null;
    return (
      <>
        {day && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
              <span>
                Día{' '}
                <b className="font-semibold tabular-nums text-slate-800">
                  {formatDateDDMMYYYY(day)}
                </b>
              </span>
              <span className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white">
                <button
                  type="button"
                  disabled={dayIndex <= 0}
                  onClick={() => selectDay(days[dayIndex - 1])}
                  className="px-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                  aria-label="Día anterior con informes"
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={dayIndex >= days.length - 1}
                  onClick={() => selectDay(days[dayIndex + 1])}
                  className="border-l border-slate-200 px-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                  aria-label="Día siguiente con informes"
                >
                  ›
                </button>
              </span>
            </div>

            <ClinicalExplorerLabTable
              analysis={lab.analysis}
              exams={lab.exams}
              day={day}
              identity={identity}
            />
          </>
        )}
        <div className="border-t border-slate-100 pt-1">
          <button
            type="button"
            aria-expanded={selection.trends === 'open'}
            aria-controls={trendsId}
            onClick={() =>
              setSelection({
                ...selection,
                trends: selection.trends === 'open' ? 'closed' : 'open',
              })
            }
            className="flex min-h-8 w-full items-center justify-between rounded-md px-1 text-left text-[12px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
          >
            Tendencias
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={selection.trends === 'open' ? 'rotate-180' : ''}
            />
          </button>
          <div id={trendsId} hidden={selection.trends !== 'open'}>
            {selection.trends !== 'unopened' && (
              <ErrorBoundary
                key={scope}
                fallbackRender={({ resetErrorBoundary }) => (
                  <ReadFailure
                    summary="No se pudieron mostrar las tendencias."
                    message="Vuelve a intentarlo."
                    onRetry={resetErrorBoundary}
                  />
                )}
              >
                <Suspense fallback={<SkeletonLines label="Cargando tendencias" />}>
                  <LabTrends
                    analysis={lab.analysis}
                    exams={lab.exams}
                    open={selection.trends === 'open'}
                    expanded={expanded}
                    censusDate={censusDate}
                    admissionDate={patient.data.admissionDate}
                    day={day}
                    selectDay={selectDay}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <AreaCard
      icon={<FlaskConical />}
      title="Laboratorio"
      subtitle={subtitle}
      source="Syslab"
      actions={
        !expanded && lab.phase === 'ready' ? (
          <LinkButton onClick={() => onShowAll('lab')}>Ver todo ›</LinkButton>
        ) : undefined
      }
    >
      {body()}
    </AreaCard>
  );
};
