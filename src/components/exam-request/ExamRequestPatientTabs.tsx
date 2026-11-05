/**
 * Patients of one laboratory request: a tab per patient with the count of marked exams, and the
 * census list to add or remove patients. Screen only; the forms print one page each.
 */

import React, { useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { ExamRequestCandidate, ExamRequestOrder } from '@/hooks/useExamRequestOrders';

/** Ids that tie each tab to the form it shows; the dialog gives the same ids to the forms. */
export const examRequestTabId = (prefix: string, index: number): string => `${prefix}-tab-${index}`;
export const examRequestPanelId = (prefix: string, index: number): string =>
  `${prefix}-panel-${index}`;

interface ExamRequestPatientTabsProps {
  idPrefix: string;
  candidates: ExamRequestCandidate[];
  orders: ExamRequestOrder[];
  activeKey: string | undefined;
  isIncluded: (key: string) => boolean;
  onSelect: (key: string) => void;
  onTogglePatient: (key: string) => void;
}

export const ExamRequestPatientTabs: React.FC<ExamRequestPatientTabsProps> = ({
  idPrefix,
  candidates,
  orders,
  activeKey,
  isIncluded,
  onSelect,
  onTogglePatient,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Arrows, Home and End move between patients, as in any tab list.
  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const last = orders.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % orders.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + orders.length) % orders.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(orders[next].key);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="mb-3 flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="tablist" aria-label="Pacientes de la solicitud" className="flex flex-wrap gap-1">
          {orders.map((order, index) => {
            const selected = order.key === activeKey;
            return (
              <button
                key={order.key}
                ref={element => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={examRequestTabId(idPrefix, index)}
                aria-controls={examRequestPanelId(idPrefix, index)}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(order.key)}
                onKeyDown={event => onTabKeyDown(event, index)}
                className={clsx(
                  'inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600',
                  selected
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                <span className="font-bold">{order.label}</span>
                <span className="truncate font-medium uppercase">
                  {order.patient.patientName.trim()}
                </span>
                <span
                  className="rounded-full bg-white/80 px-1.5 text-[10px] tabular-nums ring-1 ring-slate-200"
                  aria-label={`${order.selectedExams.size} exámenes marcados`}
                >
                  {order.selectedExams.size}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(open => !open)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          <Users size={14} aria-hidden="true" />
          Pacientes
          {pickerOpen ? (
            <ChevronUp size={13} aria-hidden="true" />
          ) : (
            <ChevronDown size={13} aria-hidden="true" />
          )}
        </button>
      </div>
      {pickerOpen && (
        <fieldset className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-3">
          <legend className="sr-only">Pacientes del censo para esta solicitud</legend>
          {candidates.map(candidate => {
            const included = isIncluded(candidate.key);
            return (
              <label
                key={candidate.key}
                className="flex min-w-0 cursor-pointer items-center gap-1.5 text-[12px] text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={included}
                  // The request keeps at least one patient.
                  disabled={included && orders.length === 1}
                  onChange={() => onTogglePatient(candidate.key)}
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                <span className="font-bold">{candidate.label}</span>
                <span className="truncate uppercase">{candidate.patient.patientName.trim()}</span>
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
};
