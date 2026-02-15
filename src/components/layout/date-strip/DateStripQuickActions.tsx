import React from 'react';
import { Box, LayoutGrid, Lock } from 'lucide-react';
import clsx from 'clsx';

interface DateStripQuickActionsProps {
  onOpenBedManager?: () => void;
  localViewMode: 'TABLE' | '3D';
  setLocalViewMode: (v: 'TABLE' | '3D') => void;
}

export const DateStripQuickActions: React.FC<DateStripQuickActionsProps> = ({
  onOpenBedManager,
  localViewMode,
  setLocalViewMode,
}) => (
  <div className="flex items-center gap-1">
    {onOpenBedManager && (
      <button
        onClick={onOpenBedManager}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 transition-colors text-[11px] font-semibold"
        title="Bloqueo de camas"
      >
        <Lock size={14} />
        <span className="hidden sm:inline">Camas</span>
      </button>
    )}

    <button
      onClick={() => setLocalViewMode(localViewMode === 'TABLE' ? '3D' : 'TABLE')}
      className={clsx(
        'flex items-center justify-center p-1.5 rounded-md border transition-all',
        localViewMode === '3D'
          ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
      )}
      title={localViewMode === '3D' ? 'Volver a Tabla' : 'Ver Mapa 3D'}
    >
      {localViewMode === '3D' ? <LayoutGrid size={15} /> : <Box size={15} />}
    </button>
  </div>
);
