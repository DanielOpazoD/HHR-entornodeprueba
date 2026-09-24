import type { JevSuggestion } from '@/services/specialty/specialtyJevClient';

interface JevControlsProps {
  busy: boolean;
  suggestion: { requestId: string; result: JevSuggestion } | null;
  onConsult: () => void;
  onAccept: () => void;
}

export const SpecialtyJevControls = ({
  busy,
  suggestion,
  onConsult,
  onAccept,
}: JevControlsProps) => (
  <div className="mt-1 border-t border-slate-200 pt-1">
    <button
      type="button"
      onClick={onConsult}
      disabled={busy}
      className="rounded px-1.5 py-1 text-left text-[11px] text-teal-700 hover:bg-teal-50 disabled:opacity-50"
    >
      {busy ? 'Consultando…' : suggestion ? 'Nueva consulta Jev' : 'Consultar sugerencia Jev'}
    </button>
    {suggestion && (
      <div className="px-1.5 text-[11px] text-slate-600">
        {suggestion.result.specialty ? (
          <>
            Sugerencia: <strong>{suggestion.result.specialty}</strong>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="mt-1 block rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50"
            >
              Aceptar para este episodio
            </button>
          </>
        ) : (
          'Jev indica que requiere revisión manual.'
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
