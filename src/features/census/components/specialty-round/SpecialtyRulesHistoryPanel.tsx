import { History } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import type { useSpecialtyRulesEditor } from './useSpecialtyRulesEditor';

export const SpecialtyRulesHistoryPanel = ({
  editor,
}: {
  editor: ReturnType<typeof useSpecialtyRulesEditor>;
}) => {
  const {
    setup,
    memory,
    busy,
    memoryPendingDeploy,
    changeMemory,
    today,
    historyMonth,
    historyState,
    history,
    changeHistoryMonth,
    loadHistory,
    rules,
    stageAssociation,
  } = editor;
  return (
    <section className="space-y-2" aria-label="Asociaciones históricas">
      <h3 className="flex items-center gap-1.5 font-semibold text-slate-900">
        <History size={16} aria-hidden="true" /> Asociaciones históricas
      </h3>
      <p className="mb-3 text-xs text-slate-600">
        Revisa las asociaciones observadas antes de usarlas como regla.
      </p>
      {memory.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700">
            Asociaciones recordadas ·{setup?.policy.memoryEnabled ? ' activas' : ' inactivas'}
          </p>
          {memory.map(item => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2"
            >
              <strong className="w-16">{item.cie10Code}</strong>
              <span className="min-w-0 flex-1 text-xs">
                {setup?.labels[item.cie10Code] || 'Descripción no disponible'}
              </span>
              <select
                aria-label={`Asociación recordada para ${item.cie10Code}`}
                value={item.kind === 'review' ? 'review' : item.specialty}
                disabled={busy || memoryPendingDeploy}
                onChange={event => changeMemory(item.id, event.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1.5"
              >
                {SPECIALTY_OPTIONS.filter(option => option !== 'Otro').map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="review">Revisión manual</option>
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="specialty-history-month">Mes del censo</label>
        <input
          id="specialty-history-month"
          type="month"
          value={historyMonth}
          max={today.slice(0, 7)}
          disabled={historyState === 'loading'}
          onChange={event => changeHistoryMonth(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
        <button
          type="button"
          disabled={historyState === 'loading'}
          onClick={() => void loadHistory()}
          className="rounded border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
        >
          {historyState === 'loading' ? 'Leyendo…' : 'Ver diagnósticos históricos'}
        </button>
      </div>
      {historyState === 'error' && (
        <p role="alert" className="mt-2 text-amber-800">
          No se pudo leer ese mes desde el servidor. Reintenta.
        </p>
      )}
      {historyState === 'ready' && !history.length && (
        <p className="mt-2 text-slate-500">Sin asociaciones CIE-10 y especialidad en ese mes.</p>
      )}
      {history.length > 0 && (
        <div className="mt-3 space-y-2">
          {history.map(item => (
            <div
              key={`${item.code}|${item.specialty}`}
              className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2"
            >
              <strong className="w-16">{item.code}</strong>
              <span className="min-w-32 flex-1 text-xs">
                {setup?.labels[item.code] || 'Descripción no disponible'}
                <span className="block text-slate-500">
                  {item.specialty} · {item.observations}{' '}
                  {item.observations === 1 ? 'observación' : 'observaciones'} · última{' '}
                  {item.lastDate}
                </span>
              </span>
              <button
                type="button"
                disabled={
                  busy ||
                  !setup ||
                  (!rules.some(rule => rule.cie10Code === item.code) && rules.length >= 128)
                }
                onClick={() => stageAssociation(item.code, item.specialty)}
                className="rounded border border-teal-300 px-2 py-1.5 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
              >
                Usar como regla
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
