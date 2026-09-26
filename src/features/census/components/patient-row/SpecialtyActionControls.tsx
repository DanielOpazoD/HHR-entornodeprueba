import type { SpecialtyDecisionMeta } from '@/types/domain/specialtyDecision';
import {
  SPECIALTY_CHIP_FALLBACK,
  SPECIALTY_CHIP_STYLES,
} from '@/constants/clinicalSpecialtyConstants';
import clsx from 'clsx';

export const SpecialtyBadge = ({
  specialty,
  decision,
  readOnly = false,
}: {
  specialty: string;
  decision?: SpecialtyDecisionMeta;
  readOnly?: boolean;
}) => {
  const assigned = specialty.length > 0;
  const badge = assigned ? (
    <span
      className={clsx(
        'truncate rounded px-1 py-px text-[9px] font-medium ring-1',
        SPECIALTY_CHIP_STYLES[specialty] ?? SPECIALTY_CHIP_FALLBACK,
        !readOnly && 'cursor-pointer'
      )}
    >
      {specialty}
    </span>
  ) : (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded border border-dashed border-slate-300 bg-slate-50 px-1 py-px text-[9px] font-medium text-slate-500',
        !readOnly && 'cursor-pointer hover:bg-slate-100'
      )}
    >
      {decision?.source === 'manual' ? 'Sin asignar · manual' : 'Pendiente asignar'}
    </span>
  );
  return readOnly ? (
    <span
      className="flex min-w-0 items-center gap-1"
      title={assigned ? `Especialidad: ${specialty}` : 'Sin especialidad'}
    >
      {badge}
    </span>
  ) : (
    badge
  );
};

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
