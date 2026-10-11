import React from 'react';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type {
  NeonatalPlacementReview as Review,
  NeonatalPlacementResolution,
} from '../contracts/neonatalPlacementReview';

/** A clinical wall clock must resolve uniquely, including DST. Never guess the onset of illness. */
export const neonatalEffectiveInstants = (local: string): string[] => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const matches = ['-05:00', '-06:00']
    .map(offset => `${local}:00${offset}`)
    .filter(iso => {
      const stamp = calendarStampInClinicalTimeZone(new Date(iso));
      return `${stamp.iso}T${stamp.hhmm}` === local;
    });
  return matches;
};
export const neonatalEffectiveInstant = (local: string): string | undefined => {
  const matches = neonatalEffectiveInstants(local);
  return matches.length === 1 ? matches[0] : undefined;
};
export const NeonatalPlacementReview: React.FC<{
  reviews: Review[];
  choices: NeonatalPlacementResolution[];
  onChange: (choices: NeonatalPlacementResolution[]) => void;
}> = ({ reviews, choices, onChange }) => {
  const [localTimes, setLocalTimes] = React.useState<Record<string, string>>({});
  const reviewKey = reviews.map(r => `${r.episodeId}:${r.source.bed}:${r.source.run}`).join('|');
  React.useEffect(() => setLocalTimes({}), [reviewKey]);
  if (!reviews.length) return null;
  const change = (choice: NeonatalPlacementResolution) =>
    onChange([...choices.filter(c => c.episodeId !== choice.episodeId), choice]);
  return (
    <section
      className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"
      aria-label="Ubicación del RN"
    >
      <h4 className="text-sm font-semibold text-slate-800">Confirma la ubicación del RN</h4>
      <p className="mt-1 text-xs text-slate-600">
        Cuna con su madre o cama independiente. Corrige también el tipo de cama en Gestión de Camas.
      </p>
      {reviews.map(review => {
        const choice = choices.find(c => c.episodeId === review.episodeId);
        const selectedTime = choice?.effectiveAt
          ? calendarStampInClinicalTimeZone(new Date(choice.effectiveAt))
          : undefined;
        const localTime =
          localTimes[review.episodeId] ??
          (selectedTime ? `${selectedTime.iso}T${selectedTime.hhmm}` : '');
        const possibleTimes = neonatalEffectiveInstants(localTime);
        return (
          <div key={review.episodeId} className="mt-3 space-y-2">
            <p className="text-sm font-medium">{review.patient.patientName}</p>
            <label className="block text-xs">
              Ubicación de {review.patient.patientName}
              <select
                value={
                  choice?.kind === 'deferred'
                    ? 'deferred:pending'
                    : choice
                      ? `${choice.kind}:${choice.bedId}`
                      : ''
                }
                className="mt-1 block w-full rounded border bg-white p-2"
                onChange={event => {
                  const [kind, bedId] = event.target.value.split(':');
                  if (kind === 'deferred') {
                    change({ episodeId: review.episodeId, kind: 'deferred', bedId: '' });
                    return;
                  }
                  if (!bedId) {
                    onChange(choices.filter(c => c.episodeId !== review.episodeId));
                    return;
                  }
                  change({
                    episodeId: review.episodeId,
                    kind: kind as 'mother' | 'independent',
                    bedId,
                    ...(kind === 'independent' && choice?.kind === 'independent'
                      ? { effectiveAt: choice.effectiveAt }
                      : {}),
                    ...(kind === 'mother'
                      ? { parentEpisodeId: review.mothers.find(m => m.bedId === bedId)?.episodeId }
                      : {}),
                  });
                }}
              >
                <option value="">Seleccionar…</option>
                <option value="deferred:pending">
                  Revisar después · sin asociación automática
                </option>
                <optgroup label="Cuna con madre">
                  {review.mothers.map(m => (
                    <option key={m.episodeId} value={`mother:${m.bedId}`}>
                      C-{m.bedId} · {m.name}
                      {m.occupiedByEpisodeId && m.occupiedByEpisodeId !== review.episodeId
                        ? ' · cuna ocupada: revisar'
                        : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="RN hospitalizado · cama independiente">
                  {review.independentBeds.map(id => (
                    <option
                      key={id}
                      value={`independent:${id}`}
                      disabled={review.unavailableIndependentBeds?.includes(id)}
                    >
                      {id}
                      {review.unavailableIndependentBeds?.includes(id)
                        ? ' · ocupada / no disponible'
                        : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {choice?.kind === 'independent' && (
              <label className="block text-xs">
                Hospitalizado en cama independiente desde (Rapa Nui)
                <input
                  type="datetime-local"
                  value={localTime}
                  aria-label="Hospitalizado en cama independiente desde (Rapa Nui)"
                  className="ml-2 rounded border bg-white p-1"
                  onChange={event => {
                    setLocalTimes(previous => ({
                      ...previous,
                      [review.episodeId]: event.target.value,
                    }));
                    change({
                      ...choice,
                      effectiveAt: neonatalEffectiveInstant(event.target.value),
                    });
                  }}
                />
                {possibleTimes.length > 1 && (
                  <select
                    aria-label="Ocurrencia de la hora de hospitalización"
                    value={choice.effectiveAt ?? ''}
                    onChange={event =>
                      change({ ...choice, effectiveAt: event.target.value || undefined })
                    }
                    className="ml-2 rounded border bg-white p-1"
                  >
                    <option value="">Selecciona la hora repetida…</option>
                    {possibleTimes.map((iso, index) => (
                      <option key={iso} value={iso}>
                        {index === 0 ? 'Primera' : 'Segunda'} ocurrencia · UTC{iso.slice(-6)}
                      </option>
                    ))}
                  </select>
                )}
                <span className="mt-1 block text-slate-500">
                  CUDYR según tiempo de hospitalización y demás criterios. No se crea un registro
                  manual.
                </span>
              </label>
            )}
          </div>
        );
      })}
    </section>
  );
};
