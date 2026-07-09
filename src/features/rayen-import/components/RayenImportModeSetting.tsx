import React from 'react';
import { useRayenImportMode } from '../hooks/useRayenImportMode';
import type { RayenImportMode } from '../settings/rayenImportSettings';

interface OptionProps {
  value: RayenImportMode;
  current: RayenImportMode;
  title: string;
  description: string;
  badge?: string;
  onSelect: (mode: RayenImportMode) => void;
}

const Option: React.FC<OptionProps> = ({ value, current, title, description, badge, onSelect }) => (
  <label
    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
      current === value ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'
    }`}
  >
    <input
      type="radio"
      name="rayen-import-mode"
      className="mt-1"
      checked={current === value}
      onChange={() => onSelect(value)}
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
  const { mode, setMode } = useRayenImportMode();

  return (
    <div data-module="rayen-import" data-testid="rayen-import-mode-setting">
      <h3 className="text-sm font-semibold text-gray-800">Sincronización con Rayen</h3>
      <p className="mb-3 text-xs text-gray-500">
        Cómo se aplican los datos importados desde Rayen al censo.
      </p>
      <div className="space-y-2">
        <Option
          value="preview"
          current={mode}
          title="Revisión y confirmación (recomendado)"
          description="Muestra un resumen de los cambios y requiere que un usuario confirme antes de aplicar."
          onSelect={setMode}
        />
        <Option
          value="auto"
          current={mode}
          title="Automático inteligente"
          badge="Experimental"
          description="Aplica los cambios sin confirmación. Los conflictos igual se retienen para revisión manual."
          onSelect={setMode}
        />
      </div>
      {mode === 'auto' && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-700">
          ⚠️ Modo experimental activo: el censo se actualizará automáticamente al recibir datos de
          Rayen.
        </p>
      )}
    </div>
  );
};
