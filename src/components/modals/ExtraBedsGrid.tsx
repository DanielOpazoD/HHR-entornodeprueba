import React from 'react';
import { CheckCircle } from 'lucide-react';
import clsx from 'clsx';

export interface ExtraBedGridItem {
  id: string;
  name: string;
  isEnabled: boolean;
}

interface ExtraBedsGridProps {
  beds: ExtraBedGridItem[];
  disabled: boolean;
  onToggleBed: (bedId: string) => void;
}

export const ExtraBedsGrid: React.FC<ExtraBedsGridProps> = ({ beds, disabled, onToggleBed }) => (
  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
    {beds.map(bed => (
      <button
        key={bed.id}
        onClick={() => onToggleBed(bed.id)}
        className={clsx(
          'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-[11px] font-bold shadow-sm transition-all active:scale-95',
          bed.isEnabled
            ? 'border-medical-500 bg-medical-50 text-medical-700 hover:bg-medical-100'
            : 'border-slate-100 bg-white text-slate-500 hover:border-medical-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-medical-500/20'
        )}
        disabled={disabled}
        aria-label={
          bed.isEnabled ? `Desactivar cama extra ${bed.name}` : `Activar cama extra ${bed.name}`
        }
        aria-pressed={bed.isEnabled}
      >
        <span className="leading-none">{bed.name}</span>
        {bed.isEnabled ? (
          <CheckCircle size={12} className="text-medical-600" aria-hidden="true" />
        ) : (
          <div className="h-2" aria-hidden="true" />
        )}
      </button>
    ))}
  </div>
);
