import React from 'react';
import { Lock } from 'lucide-react';
import clsx from 'clsx';

export interface BlockedBedGridItem {
  id: string;
  name: string;
  isBlocked: boolean;
  blockedReason?: string;
}

interface BlockedBedsGridProps {
  beds: BlockedBedGridItem[];
  disabled: boolean;
  onBedClick: (bed: BlockedBedGridItem) => void;
}

export const BlockedBedsGrid: React.FC<BlockedBedsGridProps> = ({ beds, disabled, onBedClick }) => (
  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
    {beds.map(bed => (
      <button
        key={bed.id}
        onClick={() => onBedClick(bed)}
        className={clsx(
          'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-[11px] font-bold shadow-sm transition-all active:scale-95',
          bed.isBlocked
            ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-slate-100 bg-white text-slate-500 hover:border-medical-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-medical-500/20'
        )}
        disabled={disabled}
        aria-label={`Gestionar cama ${bed.name}: ${bed.isBlocked ? 'Bloqueada' : 'Disponible'}`}
      >
        <span className="leading-none">{bed.name}</span>
        {bed.isBlocked ? (
          <Lock size={12} className="text-amber-500" aria-hidden="true" />
        ) : (
          <div className="h-2" aria-hidden="true" />
        )}
      </button>
    ))}
  </div>
);
