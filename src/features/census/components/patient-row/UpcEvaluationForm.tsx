import React from 'react';
import type { useUpcChecklistState } from './useUpcChecklistState';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { formatDateDDMMYYYY, formatDateTimeCL } from '@/utils/dateDisplayUtils';
import { Save, LoaderCircle } from 'lucide-react';

type Props = {
  state: ReturnType<typeof useUpcChecklistState>;
  checklist?: UpcChecklistRecord;
  date: string;
  reason: string | null;
};

export const UpcEvaluationForm = ({ state, checklist, date, reason }: Props) => (
  <div className="space-y-1.5 text-xs">
    <p className={reason ? 'font-semibold text-amber-800' : 'text-slate-600'}>
      {reason || 'Evaluación vigente'} · {formatDateDDMMYYYY(date).replace(/^0(\d-)/, '$1')}
    </p>
    {checklist?.evaluatedAt && (
      <p className="text-[10px] text-slate-500">
        Última: {formatDateTimeCL(checklist.evaluatedAt).replace(/^0(\d-)/, '$1')} ·{' '}
        {checklist.responsibleNurse?.name || 'Sin responsable registrado'}
      </p>
    )}
    <fieldset disabled={state.isSaving} className="space-y-2">
      <label className="flex items-center gap-2">
        <span className="w-16">Enfermero/a</span>
        {state.assignedNurseOptions.length ? (
          <select
            aria-label="Enfermero responsable"
            value={state.selectedNurseName}
            onChange={event => state.setNurseName(event.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">Seleccionar responsable</option>
            {state.assignedNurseOptions.map(name => (
              <option key={name}>{name}</option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Nombre del enfermero responsable"
            value={state.selectedNurseName}
            maxLength={120}
            autoComplete="off"
            placeholder="Escribe tu nombre"
            onChange={event => state.setNurseName(event.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
          />
        )}
      </label>
    </fieldset>
    {state.saveError && (
      <p role="alert" className="text-red-700">
        {state.saveError}
      </p>
    )}
    {state.saved && (
      <p role="status" className="text-emerald-700">
        Evaluación guardada y confirmada.
      </p>
    )}
    <button
      type="button"
      disabled={!state.canSave}
      onClick={() => void state.saveEvaluation()}
      aria-describedby="upc-save-hint"
      className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 py-2 font-bold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-800 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-emerald-200"
    >
      {state.isSaving ? (
        <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
      ) : (
        <Save size={15} aria-hidden="true" />
      )}
      {state.isSaving
        ? 'Confirmando guardado…'
        : state.hasDraftCriteria
          ? 'Guardar evaluación UPC'
          : 'Confirmar sin criterios UPC'}
    </button>
    <p id="upc-save-hint" className="text-[10px] font-medium text-emerald-800" aria-live="polite">
      {state.isSaving
        ? 'Esperando confirmación del guardado…'
        : state.saveDisabledReason
          ? state.saveDisabledReason
          : 'Pulsa Guardar para registrar esta evaluación y añadirla al historial.'}
    </p>
  </div>
);
