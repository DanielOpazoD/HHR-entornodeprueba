import React from 'react';
import { Check, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { DeliveryRoute } from '@/features/census/controllers/deliveryRoutePopoverController';

interface DeliveryRoutePopoverPanelProps {
  selectedDate: string;
  canSave: boolean;
  hasPersistedData: boolean;
  routeButtonModels: Array<{
    route: DeliveryRoute;
    label: string;
    isSelected: boolean;
    className: string;
  }>;
  onClose: () => void;
  onRouteSelect: (route: DeliveryRoute) => void;
  onDateChange: (value: string) => void;
  onClear: () => void;
  onSave: () => void;
}

export const DeliveryRoutePopoverPanel: React.FC<DeliveryRoutePopoverPanelProps> = ({
  selectedDate,
  canSave,
  hasPersistedData,
  routeButtonModels,
  onClose,
  onRouteSelect,
  onDateChange,
  onClear,
  onSave,
}) => (
  <div className="fixed w-52 bg-white rounded-xl shadow-2xl border border-slate-200 z-[9999] animate-in fade-in slide-in-from-top-1 duration-150">
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        Vía del Parto
      </span>
      <button
        type="button"
        onClick={onClose}
        className="p-0.5 text-slate-400 hover:text-slate-600 rounded transition-colors"
      >
        <X size={12} />
      </button>
    </div>

    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {routeButtonModels.map(option => (
          <button
            key={option.route}
            type="button"
            onClick={() => onRouteSelect(option.route)}
            className={option.className}
          >
            {option.isSelected && <Check size={10} />}
            {option.label}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] font-medium text-slate-400 px-0.5">Fecha</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => onDateChange(e.target.value)}
          className="w-full px-2 py-1 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-medical-500/10 focus:border-medical-500 transition-all font-medium"
        />
      </div>

      <div className="flex gap-2 pt-1">
        {hasPersistedData && (
          <button
            type="button"
            onClick={onClear}
            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Limpiar"
          >
            <Trash2 size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className={clsx(
            'flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all',
            canSave
              ? 'bg-medical-600 text-white hover:bg-medical-500 shadow-sm'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          )}
        >
          Guardar
        </button>
      </div>
    </div>
  </div>
);
