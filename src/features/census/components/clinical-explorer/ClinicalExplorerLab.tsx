import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, FileText, FlaskConical } from 'lucide-react';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { useSyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { ClinicalExplorerLabCharts } from './ClinicalExplorerLabCharts';
import {
  buildLabDayRows,
  buildLabSeriesModel,
  selectDefaultLabVariables,
} from './clinicalExplorerLabModel';
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

const COMPACT_VARIABLES = 4;
const EXPANDED_VARIABLES = 6;
const COMPACT_ROWS = 6;

/** Syslab reports of the hospitalization: one chart per variable and the full table of one day. */
export const ClinicalExplorerLab: React.FC<ClinicalExplorerLabProps> = ({
  patient,
  censusDate,
  tab,
  onShowAll,
}) => {
  const expanded = tab === 'lab';
  const limit = expanded ? EXPANDED_VARIABLES : COMPACT_VARIABLES;
  const identity = `${patient.data.rut.trim()}:${patient.episodeId}`;
  const lab = useSyslabHospitalizationReports({
    rut: patient.data.rut.trim(),
    episodeId: patient.episodeId,
    admissionDate: patient.data.admissionDate,
    enabled: true,
  });
  const model = useMemo(
    () => (lab.analysis ? buildLabSeriesModel(lab.analysis, lab.exams) : null),
    [lab.analysis, lab.exams]
  );
  // Selections belong to one patient and episode; another identity starts from the defaults.
  const [stored, setSelection] = useState<{
    identity: string;
    names: string[];
    day: string | null;
  }>({ identity, names: [], day: null });
  const selection = stored.identity === identity ? stored : { identity, names: [], day: null };
  // Only the charted variables show by default; the rest of the list opens on demand.
  const [allVariablesShown, setAllVariablesShown] = useState(false);

  // Selection by series id, so a variable keeps its place when its shown name gains a unit.
  const names = useMemo(() => {
    if (!model) return [];
    const chosen = selection.names.filter(id => model.variables.some(v => v.id === id));
    return (chosen.length ? chosen : selectDefaultLabVariables(model.variables, limit)).slice(
      0,
      limit
    );
  }, [model, selection.names, limit]);
  const day =
    selection.day && model?.days.includes(selection.day)
      ? selection.day
      : (model?.days[model.days.length - 1] ?? null);
  const dayIndex = day && model ? model.days.indexOf(day) : -1;
  const rows = useMemo(
    () => (lab.analysis && day ? buildLabDayRows(lab.analysis, day) : []),
    [lab.analysis, day]
  );
  const shownRows = expanded ? rows : rows.slice(0, COMPACT_ROWS);

  // Both start from the selection of the current identity, never from another patient's.
  const selectDay = (next: string | undefined): void => {
    if (next) setSelection({ identity, names: selection.names, day: next });
  };
  const toggleVariable = (id: string): void => {
    const next = names.includes(id)
      ? names.filter(item => item !== id)
      : [...names, id].slice(-limit);
    setSelection({ identity, names: next, day: selection.day });
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
            Leyendo informes
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
    if (!model || !lab.analysis) return null;
    const startIso =
      [patient.data.admissionDate, model.days[0]].filter(Boolean).sort()[0] ?? censusDate;
    const selected = names
      .map(id => model.variables.find(variable => variable.id === id))
      .filter((variable): variable is NonNullable<typeof variable> => Boolean(variable));
    const selectedAnalyses = new Set(selected.map(variable => variable.analysis));
    const hiddenCount = model.variables.length - selected.length;
    const shownVariables = allVariablesShown
      ? model.variables
      : model.variables.filter(variable => names.includes(variable.id));
    return (
      <>
        <div role="group" aria-label="Variables" className="flex flex-wrap items-center gap-1">
          {shownVariables.map(variable => {
            const on = names.includes(variable.id);
            return (
              <button
                key={variable.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleVariable(variable.id)}
                className={clsx(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                  on
                    ? 'border-teal-200 bg-teal-50 text-teal-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {on && <Check size={11} aria-hidden="true" className="text-teal-600" />}
                {variable.name}
              </button>
            );
          })}
          {(allVariablesShown || hiddenCount > 0) && (
            <button
              type="button"
              aria-expanded={allVariablesShown}
              onClick={() => setAllVariablesShown(shown => !shown)}
              className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              {allVariablesShown ? 'Menos exámenes' : `Más exámenes (${hiddenCount})`}
              {allVariablesShown ? (
                <ChevronUp size={12} aria-hidden="true" />
              ) : (
                <ChevronDown size={12} aria-hidden="true" />
              )}
            </button>
          )}
          {allVariablesShown && (
            <span className="ml-1 text-[11px] text-slate-500">hasta {limit} a la vez</span>
          )}
        </div>
        {selected.length > 0 ? (
          <ClinicalExplorerLabCharts
            variables={selected}
            startIso={startIso}
            endIso={censusDate < startIso ? startIso : censusDate}
            admissionIso={patient.data.admissionDate}
            selectedDay={day}
            onSelectDay={selectDay}
            expanded={expanded}
          />
        ) : (
          <EmptyNote>Sin variables numéricas que graficar.</EmptyNote>
        )}
        {day && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
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
                  onClick={() => selectDay(model.days[dayIndex - 1])}
                  className="px-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                  aria-label="Día anterior con informes"
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={dayIndex >= model.days.length - 1}
                  onClick={() => selectDay(model.days[dayIndex + 1])}
                  className="border-l border-slate-200 px-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                  aria-label="Día siguiente con informes"
                >
                  ›
                </button>
              </span>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500">
                  <th className="px-2.5 py-1 font-semibold">Variable</th>
                  <th className="px-2.5 py-1 text-right font-semibold">Resultado</th>
                  <th className="px-2.5 py-1 font-semibold">Unidad</th>
                  <th className="px-2.5 py-1 font-semibold">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map(row => (
                  <tr
                    key={`${row.name}|${row.columnKey}`}
                    className={clsx(
                      'border-t border-slate-100',
                      selectedAnalyses.has(row.name) && 'bg-teal-50/40'
                    )}
                  >
                    <td className="px-2.5 py-1 text-slate-700">
                      {row.name}
                      {row.time && (
                        <span className="ml-1 text-[11px] text-slate-500">{row.time}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-right font-semibold tabular-nums text-slate-800">
                      {row.display}
                    </td>
                    <td className="px-2.5 py-1 text-slate-600">{row.unit}</td>
                    <td className="px-2.5 py-1 tabular-nums text-slate-500">{row.refValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!expanded && rows.length > shownRows.length && (
              <div className="border-t border-slate-100 px-2.5 py-1.5">
                <LinkButton onClick={() => onShowAll('lab')}>
                  + {rows.length - shownRows.length} analitos más de este día
                </LinkButton>
              </div>
            )}
          </div>
        )}
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
        <>
          {!expanded && lab.phase === 'ready' && (
            <LinkButton onClick={() => onShowAll('lab')}>Ver todo ›</LinkButton>
          )}
          {lab.phase === 'ready' && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-slate-500"
              title="Los valores se muestran tal como los informa Syslab"
            >
              <FileText size={11} aria-hidden="true" />
              valores sin interpretar
            </span>
          )}
        </>
      }
    >
      {body()}
    </AreaCard>
  );
};
