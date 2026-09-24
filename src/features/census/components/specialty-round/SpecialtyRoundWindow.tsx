import { Sparkles } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { useSpecialtyRound } from './useSpecialtyRound';
import { resolveSpecialtyRoundRule } from './specialtyRoundModel';

interface SpecialtyRoundWindowProps {
  date: string;
  disabled: boolean;
  onClose: () => void;
}

export const SpecialtyRoundWindow = ({ date, disabled, onClose }: SpecialtyRoundWindowProps) => {
  const round = useSpecialtyRound(date, disabled);
  const remaining = round.eligible.filter(candidate =>
    !['ready', 'review', 'saved'].includes(round.results[candidate.key]?.state ?? '')
    && !round.choices[candidate.key]
  ).length;
  const selected = round.candidates.filter(candidate => candidate.scope &&
    round.choices[candidate.key] && round.results[candidate.key]?.state !== 'saved').length;
  const saved = Object.values(round.results).filter(result => result.state === 'saved').length;
  const failed = Object.values(round.results).filter(result => result.state === 'failed').length;

  return (
    <BaseModal isOpen onClose={() => { if (!round.busy) onClose(); }}
      closeOnBackdrop={false} size="5xl" title={`Asignación de especialidades · ${date}`}
      icon={<Sparkles size={20} className="text-teal-700" aria-hidden="true" />}>
      <div className="space-y-4 text-sm text-slate-700">
        <p>
          Revisa las especialidades pendientes de este censo. Jev propone para códigos CIE-10
          válidos; cuando falta una descripción del catálogo, sólo se envía el código. Puedes elegir una
          especialidad manualmente para los demás. Ninguna propuesta
          modifica el censo hasta pulsar «Confirmar asignaciones».
        </p>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="font-semibold text-teal-900">
            {round.candidates.length} pendientes · {round.eligible.length} consultables con Jev
          </p>
          <p className="mt-1 text-xs text-teal-800">
            Al consultar se envía a TypeSafe el código CIE-10 y, si existe, su descripción
            del catálogo. No se envían nombre, RUT, cama ni identificador de episodio.
            Se usa cuota del piloto (máximo 25 consultas mensuales).
          </p>
          {round.catalogError && <p role="alert" className="mt-2 text-red-700">{round.catalogError}</p>}
          <button type="button" onClick={() => void round.consultAll()}
            disabled={disabled || round.busy || !remaining || !round.catalog}
            className="mt-3 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
            {round.busy ? 'Procesando…' : `Obtener sugerencias Jev (${remaining})`}
          </button>
        </div>
        <div className="max-h-[48vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[650px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr><th className="p-3">Cama y paciente</th><th className="p-3">Diagnóstico</th>
                <th className="p-3">Estado</th><th className="p-3">Especialidad propuesta</th></tr>
            </thead>
            <tbody>
              {round.candidates.map(candidate => {
                const result = round.results[candidate.key];
                const label = round.labels[candidate.key];
                const rule = resolveSpecialtyRoundRule(round.rules, candidate.cie10Code);
                const requiresRuleReview = !rule && round.rules.some(item =>
                  item.cie10Code === candidate.cie10Code);
                const state = result?.state;
                return (
                  <tr key={candidate.key} className="border-t border-slate-100 align-top">
                    <td className="p-3"><strong>{candidate.bedName}</strong>
                      <span className="mt-0.5 block max-w-48 truncate" title={candidate.patientName}>
                        {candidate.patientName}
                      </span>
                    </td>
                    <td className="p-3"><strong>{candidate.cie10Code || 'Sin CIE-10'}</strong>
                      <span className="mt-0.5 block max-w-56 line-clamp-2">{candidate.diagnosis || 'Sin diagnóstico'}</span>
                      {label && <span className="mt-1 block max-w-56 text-teal-700">
                        Dato que se enviará: {label}
                      </span>}
                    </td>
                    <td className="p-3">
                      {state === 'saved' ? 'Confirmada' :
                        state === 'outdated' ? 'Episodio modificado · actualiza censo' :
                          state === 'failed' ? 'No confirmada · reintenta o revisa' :
                            state === 'consulting' ? 'Consultando Jev…' :
                              state === 'review' ? 'Jev pide revisión manual' :
                                state === 'ready' ? 'Sugerencia Jev lista' :
                                  !candidate.scope ? 'Sin episodio confirmado' :
                                    rule ? 'Regla propuesta · confirmar' :
                                    requiresRuleReview ? 'Regla exige revisión manual' :
                                    label ? 'Disponible para Jev' : 'Asignación manual'}
                    </td>
                    <td className="p-3">
                      <select aria-label={`Especialidad de ${candidate.bedName}`}
                        value={round.choices[candidate.key] ?? ''}
                        disabled={disabled || round.busy || !candidate.scope || state === 'saved' || state === 'outdated'}
                        onChange={event => round.setChoices(current => ({
                          ...current, [candidate.key]: event.target.value,
                        }))}
                        className="w-full min-w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 disabled:opacity-50">
                        <option value="">Revisión pendiente</option>
                        {SPECIALTY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                      {state === 'ready' && result?.suggestion?.specialty &&
                        <span className="mt-1 block text-teal-700">Jev sugirió {result.suggestion.specialty}</span>}
                    </td>
                  </tr>
                );
              })}
              {!round.candidates.length && <tr><td colSpan={4} className="p-6 text-center">
                No hay especialidades pendientes en este censo.
              </td></tr>}
            </tbody>
          </table>
        </div>
        {(saved > 0 || failed > 0 || round.progress) && <p role="status" aria-live="polite">
          {round.progress || `${saved} confirmadas · ${failed} requieren revisión`}
        </p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={onClose} disabled={round.busy}
            className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 disabled:opacity-50">
            {saved ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="button" onClick={() => void round.saveAll()}
            disabled={disabled || round.busy || !selected}
            className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            Confirmar {selected} {selected === 1 ? 'asignación' : 'asignaciones'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
