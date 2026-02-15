import React from 'react';
import clsx from 'clsx';
import { Move, Save, Settings } from 'lucide-react';

interface HospitalFloorMapToolbarProps {
  isEditMode: boolean;
  showConfig: boolean;
  onToggleEditMode: () => void;
  onToggleConfig: () => void;
}

export const HospitalFloorMapToolbar: React.FC<HospitalFloorMapToolbarProps> = ({
  isEditMode,
  showConfig,
  onToggleEditMode,
  onToggleConfig,
}) => (
  <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
    <div className="bg-white/90 backdrop-blur p-1 rounded-lg shadow-sm border border-slate-200 flex gap-1 pointer-events-auto">
      <button
        onClick={onToggleEditMode}
        className={clsx(
          'p-2 rounded-md transition-all',
          isEditMode ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-100 text-slate-500'
        )}
        title={isEditMode ? 'Finalizar Edición' : 'Editar Distribución'}
      >
        {isEditMode ? <Save size={18} /> : <Move size={18} />}
      </button>
      <button
        onClick={onToggleConfig}
        className={clsx(
          'p-2 rounded-md transition-all',
          showConfig ? 'bg-slate-100 text-slate-800' : 'hover:bg-slate-100 text-slate-500'
        )}
        title="Configuración Visual"
      >
        <Settings size={18} />
      </button>
    </div>
  </div>
);
