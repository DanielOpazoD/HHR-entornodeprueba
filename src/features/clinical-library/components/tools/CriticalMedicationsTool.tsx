import React, { useState } from 'react';
import clsx from 'clsx';
import { Pill, Printer } from 'lucide-react';
import {
  CRITICAL_MEDICATIONS,
  CRITICAL_MEDICATIONS_SHEET,
  CRITICAL_MEDICATION_GROUP_LABELS,
  ROUTE_ALLOWANCE_LABELS,
  presentationFor,
  type AmpouleVariant,
  type CriticalMedication,
  type RouteAllowance,
} from '../../domain/criticalMedications';
import { normalizeSearchText } from '../../domain/librarySearch';
import { buildCriticalMedicationsDocument } from '../../controllers/criticalMedicationsPrint';
import { printHtmlDocument } from '../../services/printHtmlDocument';
import { SegmentedControl, TextField } from './ToolField';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';
import { PRINT_ACTION_CLASS } from './TransferCoverTool';

const ALLOWANCE_CLASS: Readonly<Record<RouteAllowance, string>> = {
  si: 'bg-emerald-50 text-emerald-700',
  cond: 'bg-amber-50 text-amber-700',
  no: 'bg-red-50 text-red-700',
};

const GROUPS = Object.keys(CRITICAL_MEDICATION_GROUP_LABELS) as CriticalMedication['group'][];

const Allowance: React.FC<{ label: string; value: RouteAllowance; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <span
    className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', ALLOWANCE_CLASS[value])}
    title={note}
  >
    {label} {ROUTE_ALLOWANCE_LABELS[value]}
  </span>
);

const MedicationRow: React.FC<{ medication: CriticalMedication; variant: AmpouleVariant }> = ({
  medication,
  variant,
}) => {
  const presentation = presentationFor(medication, variant);
  return (
    <li data-testid={`critical-medication-${medication.id}`} className="py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-semibold text-slate-800">
          {medication.name}
          <span className="ml-2 text-[11px] font-normal text-slate-500">{presentation.text}</span>
        </p>
        <span className="flex gap-1">
          <Allowance label="VVP" value={medication.vvp} note={medication.vvpNote} />
          <Allowance label="CVC" value={medication.cvc} />
          <Allowance label="Bolo" value={medication.bolus} note={medication.bolusText} />
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] text-slate-700">
        {presentation.preparations.map(item => (
          <li key={`${item.label ?? ''}${item.text}`}>
            {item.label && <span className="font-semibold text-medical-700">{item.label}: </span>}
            {item.text}
            {item.concentration && (
              <span className="font-bold tabular-nums"> = {item.concentration}</span>
            )}
          </li>
        ))}
      </ul>
      {medication.bolusText && (
        <p className="mt-0.5 text-[11px] text-slate-500">Bolo: {medication.bolusText}</p>
      )}
      <p className="mt-0.5 text-[11px] text-slate-600">{medication.dose}</p>
    </li>
  );
};

export const CriticalMedicationsTool: React.FC<ToolComponentProps> = ({ onBack, onClose }) => {
  const [variant, setVariant] = useState<AmpouleVariant>('amp5');
  const [query, setQuery] = useState('');
  const needle = normalizeSearchText(query);
  const visible = CRITICAL_MEDICATIONS.filter(
    medication => !needle || normalizeSearchText(medication.name).includes(needle)
  );
  const sheet = CRITICAL_MEDICATIONS_SHEET;

  return (
    <ToolFrame
      title="Medicamentos críticos"
      icon={<Pill size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-critical-medications"
      action={
        <button
          type="button"
          onClick={() => printHtmlDocument(buildCriticalMedicationsDocument(variant))}
          className={PRINT_ACTION_CLASS}
          data-testid="critical-medications-print"
        >
          <Printer size={14} aria-hidden="true" />
          Imprimir
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField id="critical-search" label="Buscar" value={query} onChange={setQuery} />
        <SegmentedControl
          label="Dopamina y dobutamina"
          value={variant}
          onChange={setVariant}
          options={[
            { value: 'amp5', label: 'Ampolla 5 mL' },
            { value: 'amp10', label: 'Ampolla 10 mL' },
          ]}
        />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">{sheet.legend}</p>

      {GROUPS.map(group => {
        const medications = visible.filter(medication => medication.group === group);
        if (medications.length === 0) return null;
        return (
          <section
            key={group}
            aria-label={CRITICAL_MEDICATION_GROUP_LABELS[group]}
            className="mt-3"
          >
            <h4 className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {CRITICAL_MEDICATION_GROUP_LABELS[group]}
            </h4>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-3">
              {medications.map(medication => (
                <MedicationRow key={medication.id} medication={medication} variant={variant} />
              ))}
            </ul>
          </section>
        );
      })}
      {visible.length === 0 && (
        <p className="py-6 text-center text-[12px] text-slate-500">Sin resultados para «{query}»</p>
      )}

      <section aria-label="Cálculo de velocidad" className="mt-3 text-[11px] text-slate-600">
        <h4 className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Cálculo de velocidad
        </h4>
        <ul className="space-y-0.5 tabular-nums">
          {sheet.formulas.map(formula => (
            <li key={formula}>{formula}</li>
          ))}
        </ul>
      </section>
      <section aria-label="Alertas" className="mt-3 text-[11px] text-red-800">
        <h4 className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
          Alertas
        </h4>
        <ul className="space-y-0.5">
          {sheet.alerts.map(alert => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
        <ul className="mt-2 space-y-0.5 text-slate-500">
          {sheet.headerNotes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <p className="mt-3 text-[10px] text-slate-400">Fuentes: {sheet.sources}</p>
    </ToolFrame>
  );
};
