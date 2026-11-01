import React from 'react';
import { useRayenImportMode } from '../hooks/useRayenImportMode';
import { useAuth } from '@/context/AuthContext';

interface OptionProps<T extends string> {
  name: string;
  value: T;
  current: T;
  title: string;
  description: string;
  badge?: string;
  disabled: boolean;
  onSelect: (mode: T) => Promise<void>;
}

const Option = <T extends string>({
  name,
  value,
  current,
  title,
  description,
  badge,
  disabled,
  onSelect,
}: OptionProps<T>) => (
  <label
    className={`flex items-start gap-3 rounded-lg border p-3 ${
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    } ${current === value ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}
  >
    <input
      type="radio"
      name={name}
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
  const { currentUser } = useAuth();
  const { mode, status, isSaving, error, initializeSafePolicy, migrateLegacyPolicy, setMode } =
    useRayenImportMode(currentUser?.uid);
  const disabled = status !== 'ready' || isSaving;

  return (
    <div data-module="rayen-import" data-testid="rayen-import-mode-setting">
      <h3 className="text-sm font-semibold text-gray-800">Sincronización con Rayen</h3>
      <p className="mb-3 text-xs text-gray-500">
        Política única para todo HHR. Cada sincronización conserva la revisión usada al comenzar.
      </p>
      <div className="space-y-2">
        <Option
          name="rayen-import-mode"
          value="preview"
          current={mode}
          title="Revisión y confirmación (recomendado)"
          description="Muestra un resumen de los cambios y requiere que un usuario confirme antes de aplicar."
          onSelect={setMode}
          disabled={disabled}
        />
        <Option
          name="rayen-import-mode"
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
      {status === 'unconfigured' && (
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void initializeSafePolicy().catch(() => undefined)}
          className="mt-3 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          Inicializar política segura
        </button>
      )}
      {status === 'migration-required' && (
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void migrateLegacyPolicy().catch(() => undefined)}
          className="mt-3 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          Migrar política a v2
        </button>
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
