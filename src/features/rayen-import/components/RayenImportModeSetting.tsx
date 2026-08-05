import React from 'react';
import { useRayenImportMode } from '../hooks/useRayenImportMode';
import type { ClinicalEnrichmentBatchMode } from '../settings/rayenImportSettings';
import { useAuthState } from '@/hooks/useAuthState';

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
  const { currentUser } = useAuthState();
  const {
    mode,
    clinicalBatchMode,
    status,
    isSaving,
    error,
    initializeSafePolicy,
    migrateLegacyPolicy,
    setMode,
    setClinicalBatchMode,
  } = useRayenImportMode(currentUser?.uid);
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
      <div className="mt-5 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-semibold text-gray-800">Persistencia clínica</h4>
        <p className="mb-3 text-xs text-gray-500">
          Define quién guarda signos vitales, escalas y dispositivos. El modo queda congelado al
          comenzar cada sincronización.
        </p>
        <div className="space-y-2">
          <Option<ClinicalEnrichmentBatchMode>
            name="rayen-clinical-batch-mode"
            value="off"
            current={clinicalBatchMode}
            title="Compatibilidad por paciente"
            description="Ruta de rollback explícita: conserva las escrituras individuales conocidas."
            onSelect={setClinicalBatchMode}
            disabled={disabled}
          />
          <Option<ClinicalEnrichmentBatchMode>
            name="rayen-clinical-batch-mode"
            value="shadow"
            current={clinicalBatchMode}
            title="Validación paralela"
            description="Guarda por paciente y compara el lote en backend sin darle autoridad."
            onSelect={setClinicalBatchMode}
            disabled={disabled}
          />
          <Option<ClinicalEnrichmentBatchMode>
            name="rayen-clinical-batch-mode"
            value="enforced"
            current={clinicalBatchMode}
            title="Lote transaccional"
            description="El backend es la única autoridad. Un fallo deja los datos reintentables y nunca degrada silenciosamente."
            onSelect={setClinicalBatchMode}
            disabled={disabled}
          />
        </div>
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
      {clinicalBatchMode === 'enforced' && (
        <p className="mt-3 rounded bg-teal-50 p-2 text-xs text-teal-800">
          Lote transaccional activo. Para volver al flujo individual, selecciona explícitamente
          «Compatibilidad por paciente».
        </p>
      )}
    </div>
  );
};
