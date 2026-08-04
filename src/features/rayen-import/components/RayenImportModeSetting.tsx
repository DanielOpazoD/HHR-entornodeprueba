import React from 'react';
import { useRayenImportMode } from '../hooks/useRayenImportMode';
import type { RayenImportMode } from '../settings/rayenImportSettings';
import { useAuthState } from '@/hooks/useAuthState';

interface OptionProps {
  value: RayenImportMode;
  current: RayenImportMode;
  title: string;
  description: string;
  badge?: string;
  disabled: boolean;
  onSelect: (mode: RayenImportMode) => Promise<void>;
}

const Option: React.FC<OptionProps> = ({
  value,
  current,
  title,
  description,
  badge,
  disabled,
  onSelect,
}) => (
  <label
    className={`flex items-start gap-3 rounded-lg border p-3 ${
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    } ${current === value ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}
  >
    <input
      type="radio"
      name="rayen-import-mode"
      className="mt-1"
      checked={current === value}
      disabled={disabled}
      onChange={() => void onSelect(value).catch(() => undefined)}
    />
    <span>
      <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        {title}
        {badge && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-xs text-gray-500">{description}</span>
    </span>
  </label>
);

/**
 * Admin control to choose the Rayen import mode. Default is preview+confirm; the
 * automatic mode is experimental. Gate rendering behind an admin check at the call site.
 */
export const RayenImportModeSetting: React.FC = () => {
  const { currentUser } = useAuthState();
  const { mode, status, isSaving, error, setMode } = useRayenImportMode(currentUser?.uid);
  const disabled = status !== 'ready' || isSaving;

  return (
    <div data-module="rayen-import" data-testid="rayen-import-mode-setting">
      <h3 className="text-sm font-semibold text-gray-800">Sincronización con Rayen</h3>
      <p className="mb-3 text-xs text-gray-500">
        Política única para todo HHR. Cada sincronización conserva la revisión usada al comenzar.
      </p>
      <div className="space-y-2">
        <Option
          value="preview"
          current={mode}
          title="Revisión y confirmación (recomendado)"
          description="Muestra un resumen de los cambios y requiere que un usuario confirme antes de aplicar."
          onSelect={setMode}
          disabled={disabled}
        />
        <Option
          value="auto"
          current={mode}
          title="Automático inteligente"
          badge="Experimental"
          description="Aplica los cambios sin confirmación. Los conflictos igual se retienen para revisión manual."
          onSelect={setMode}
          disabled={disabled}
        />
      </div>
      {status === 'loading' && (
        <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">
          Confirmando la política global con el servidor…
        </p>
      )}
      {error && <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-700">{error}</p>}
      {mode === 'auto' && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-700">
          Modo experimental global activo: el censo se actualizará automáticamente al recibir datos
          de Rayen. Los conflictos continúan requiriendo revisión.
        </p>
      )}
    </div>
  );
};
