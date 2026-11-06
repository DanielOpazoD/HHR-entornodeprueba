import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { ClinicalExplorerLabCharts } from './ClinicalExplorerLabCharts';
import { buildLabSeriesModel, selectDefaultLabVariables } from './clinicalExplorerLabModel';
import { EmptyNote } from './clinicalExplorerUi';

/** Loaded on first expansion; collapsing removes charts while retaining the chosen variables. */
export const ClinicalExplorerLabTrends = ({
  analysis,
  exams,
  open,
  expanded,
  censusDate,
  admissionDate,
  day,
  selectDay,
}: {
  analysis: LabAnalysisData;
  exams: SyslabExamItem[];
  open: boolean;
  expanded: boolean;
  censusDate: string;
  admissionDate: string;
  day: string | null;
  selectDay: (day: string) => void;
}) => {
  const limit = expanded ? 6 : 4;
  const model = useMemo(
    () => (open ? buildLabSeriesModel(analysis, exams) : null),
    [open, analysis, exams]
  );
  const [chosenNames, setChosenNames] = useState<string[]>([]);
  const [allVariablesShown, setAllVariablesShown] = useState(false);
  if (!model) return null;
  const chosen = chosenNames.filter(id => model.variables.some(v => v.id === id));
  const names = (chosen.length ? chosen : selectDefaultLabVariables(model.variables, limit)).slice(
    0,
    limit
  );
  const selected = names
    .map(id => model.variables.find(variable => variable.id === id))
    .filter((variable): variable is NonNullable<typeof variable> => Boolean(variable));
  const hiddenCount = model.variables.length - selected.length;
  const shownVariables = allVariablesShown
    ? model.variables
    : model.variables.filter(variable => names.includes(variable.id));
  const startIso = [admissionDate, model.days[0]].filter(Boolean).sort()[0] ?? censusDate;
  const toggleVariable = (id: string): void => {
    setChosenNames(
      names.includes(id) ? names.filter(item => item !== id) : [...names, id].slice(-limit)
    );
  };
  return (
    <div className="flex flex-col gap-2.5 pt-2">
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
          admissionIso={admissionDate}
          selectedDay={day}
          onSelectDay={selectDay}
          expanded={expanded}
        />
      ) : (
        <EmptyNote>Sin variables numéricas que graficar.</EmptyNote>
      )}
    </div>
  );
};
