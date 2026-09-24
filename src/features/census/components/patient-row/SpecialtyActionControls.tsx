import type { JevConsultationPreparation, JevSuggestion } from '@/services/specialty/specialtyJevClient';
import type { SpecialtyDecisionMeta } from '@/types/domain/specialtyDecision';
import { SPECIALTY_CHIP_FALLBACK, SPECIALTY_CHIP_STYLES } from '@/constants/clinicalSpecialtyConstants';
import clsx from 'clsx';

export const SpecialtyBadge = ({ specialty, decision, readOnly = false }: {
  specialty: string; decision?: SpecialtyDecisionMeta; readOnly?: boolean;
}) => {
  const assigned = specialty.length > 0;
  const badge = assigned ? (
    <span className={clsx('truncate rounded px-1 py-px text-[9px] font-medium ring-1',
      SPECIALTY_CHIP_STYLES[specialty] ?? SPECIALTY_CHIP_FALLBACK,
      !readOnly && 'cursor-pointer')}>{specialty}</span>
  ) : (
    <span className={clsx(
      'inline-flex items-center gap-0.5 rounded border border-dashed border-amber-300 bg-amber-50/60 px-1 py-px text-[9px] font-medium text-amber-600',
      !readOnly && 'cursor-pointer hover:bg-amber-100'
    )}>{decision?.source === 'manual' ? 'Sin asignar · manual' : 'Pendiente asignar'}</span>
  );
  return readOnly ? <span className="flex min-w-0 items-center gap-1"
    title={assigned ? `Especialidad: ${specialty}` : 'Sin especialidad'}>{badge}</span> : badge;
};

interface JevControlsProps {
  busy: boolean;
  suggestion: { requestId: string; result: JevSuggestion } | null;
  preparation: JevConsultationPreparation | null;
  confirmAccept: boolean;
  onPrepare: () => void;
  onCancelPrepare: () => void;
  onConsult: () => void;
  onReviewAccept: () => void;
  onCancelAccept: () => void;
  onAccept: () => void;
}

export const SpecialtyJevControls = ({
  busy,
  suggestion,
  preparation,
  confirmAccept,
  onPrepare,
  onCancelPrepare,
  onConsult,
  onReviewAccept,
  onCancelAccept,
  onAccept,
}: JevControlsProps) => (
  <div className="mt-2 border-t border-slate-200 px-1.5 pt-2 text-[11px]">
    <p className="font-semibold text-slate-800">Apoyo Jev · decisión profesional</p>
    {!preparation && (
      <button type="button" onClick={onPrepare} disabled={busy}
        className="mt-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1.5 font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50">
        {busy ? 'Preparando…' : suggestion ? 'Preparar nueva consulta Jev' : 'Preparar consulta Jev'}
      </button>
    )}
    {preparation && (
      <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-slate-700" role="group" aria-label="Confirmar consulta Jev">
        <p className="font-semibold text-teal-900">Antes de consultar</p>
        <p className="mt-1">Se enviarán a TypeSafe sólo el código <strong>{preparation.code}</strong> y la etiqueta canónica <strong>{preparation.canonicalLabel}</strong>. No se envían nombre, RUT ni episodio.</p>
        <p className="mt-1">La respuesta será una sugerencia; este paso no modifica el censo.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={onConsult} disabled={busy}
            className="rounded bg-teal-700 px-2 py-1 font-semibold text-white disabled:opacity-50">
            {busy ? 'Consultando…' : 'Confirmar y consultar'}
          </button>
          <button type="button" onClick={onCancelPrepare} disabled={busy}
            className="rounded px-2 py-1 text-slate-600 hover:bg-white">Cancelar</button>
        </div>
      </div>
    )}
    {suggestion && (
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700" role="status">
        {suggestion.result.specialty ? (
          <>
            <p>Sugerencia: <strong>{suggestion.result.specialty}</strong></p>
            <p className="mt-1">Revisa su pertinencia clínica antes de asignarla.</p>
            {confirmAccept ? (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
                <p>¿Confirmas <strong>{suggestion.result.specialty}</strong> para este episodio? Esta acción quedará registrada en el censo.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={onAccept} disabled={busy}
                    className="rounded bg-teal-700 px-2 py-1 font-semibold text-white disabled:opacity-50">
                    {busy ? 'Guardando…' : 'Confirmar asignación'}
                  </button>
                  <button type="button" onClick={onCancelAccept} disabled={busy}
                    className="rounded px-2 py-1 text-slate-600">Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={onReviewAccept} disabled={busy}
                className="mt-2 rounded bg-teal-700 px-2 py-1 font-semibold text-white disabled:opacity-50">
                Revisar aceptación
              </button>
            )}
          </>
        ) : (
          'Jev indica revisión manual. No se asignó ninguna especialidad.'
        )}
      </div>
    )}
  </div>
);

interface MemoryControlsProps {
  busy: boolean;
  confirmMemory: boolean;
  onConfirmChange: (confirmed: boolean) => void;
  onRemember: () => void;
}

export const SpecialtyMemoryControls = ({
  busy,
  confirmMemory,
  onConfirmChange,
  onRemember,
}: MemoryControlsProps) => (
  <div className="mt-1 border-t border-slate-200 px-1.5 py-1 text-[11px]">
    {confirmMemory ? (
      <>
        <p>¿Publicar una regla futura para el CIE-10 de este episodio?</p>
        <button
          type="button"
          onClick={onRemember}
          disabled={busy}
          className="mr-2 font-semibold text-teal-700 disabled:opacity-50"
        >
          Confirmar publicación
        </button>
        <button type="button" onClick={() => onConfirmChange(false)} disabled={busy}>
          Cancelar
        </button>
      </>
    ) : (
      <button
        type="button"
        onClick={() => onConfirmChange(true)}
        className="text-slate-600 hover:text-teal-700"
      >
        Recordar CIE-10 para futuras asignaciones
      </button>
    )}
  </div>
);
