import type { CensusLabDateRange } from '@/shared/contracts/censusLaboratory';
import type { CensusLaboratoryPeriodDraft } from '../controllers/censusLaboratoryPeriod';

interface Props {
  draft: CensusLaboratoryPeriodDraft;
  applied?: CensusLabDateRange;
  censusDate: string;
  today: string;
  problem: string | null;
  dirty: boolean;
  onDraft: (value: CensusLaboratoryPeriodDraft) => void;
  onApply: () => void;
}

export const CensusLaboratoryPeriod = ({
  draft,
  applied,
  censusDate,
  today,
  problem,
  dirty,
  onDraft,
  onApply,
}: Props) => (
  <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 font-semibold">Período de consulta</legend>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        Buscar
        <select
          aria-label="Tipo de período"
          className="min-h-9 max-w-full rounded border border-slate-300 bg-white px-2 text-sm"
          value={draft.mode}
          onChange={event =>
            onDraft({ ...draft, mode: event.target.value === 'custom' ? 'custom' : 'admission' })
          }
        >
          <option value="admission">Ingreso → día del censo</option>
          <option value="custom">Período personalizado</option>
        </select>
      </label>
      {draft.mode === 'custom' && (
        <>
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Desde
            <input
              type="date"
              className="min-h-9 min-w-0 rounded border border-slate-300 px-2 text-sm"
              value={draft.from}
              max={today}
              onChange={event => onDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Hasta
            <input
              type="date"
              className="min-h-9 min-w-0 rounded border border-slate-300 px-2 text-sm"
              value={draft.to}
              max={today}
              onChange={event => onDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="min-h-9 rounded border border-slate-300 px-3 text-xs"
            onClick={() => onDraft({ ...draft, to: today })}
          >
            Hasta hoy
          </button>
        </>
      )}
      <button
        type="button"
        className="min-h-9 rounded border border-teal-700 px-3 font-medium text-teal-800 disabled:opacity-50"
        disabled={!dirty || Boolean(problem)}
        onClick={onApply}
      >
        Aplicar período
      </button>
    </div>
    {problem && (
      <p role="alert" className="text-xs text-amber-800">
        {problem}
      </p>
    )}
    {dirty && !problem && (
      <p role="status" className="text-xs">
        Aplica el período antes de actualizar los exámenes.
      </p>
    )}
    <p className="text-xs text-slate-600">
      Período aplicado:{' '}
      {applied
        ? `${applied.from} → ${applied.to}`
        : `desde el ingreso de cada paciente hasta ${censusDate}`}
      . Ambos días incluidos.
    </p>
    {draft.mode === 'custom' && (
      <p className="text-xs text-slate-500">
        El rango personalizado puede incluir antecedentes previos al ingreso. No cambia el episodio
        ni el censo.
      </p>
    )}
  </fieldset>
);
