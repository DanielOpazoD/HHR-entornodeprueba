import React from 'react';
import clsx from 'clsx';
import {
  RECEIVING_CENTERS,
  RECEIVING_CENTER_EXTRASYSTEM,
  RECEIVING_CENTER_OTHER,
  type ReceivingCenter,
} from '@/constants';

interface TransferReceivingSectionProps {
  receivingCenter: ReceivingCenter;
  receivingCenterOther: string;
  otherCenterError?: string;
  onReceivingCenterChange: (value: string) => void;
  onReceivingCenterOtherChange: (value: string) => void;
}

export const TransferReceivingSection: React.FC<TransferReceivingSectionProps> = ({
  receivingCenter,
  receivingCenterOther,
  otherCenterError,
  onReceivingCenterChange,
  onReceivingCenterOtherChange,
}) => (
  <div className="space-y-4 pt-2">
    <div className="space-y-1.5">
      <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
        Centro que Recibe
      </label>
      <select
        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
        value={receivingCenter}
        onChange={event => onReceivingCenterChange(event.target.value)}
      >
        {RECEIVING_CENTERS.map(center => (
          <option key={center} value={center}>
            {center}
          </option>
        ))}
      </select>
    </div>

    {(receivingCenter === RECEIVING_CENTER_OTHER ||
      receivingCenter === RECEIVING_CENTER_EXTRASYSTEM) && (
      <div className="animate-fade-in space-y-1.5 border-l-2 border-blue-50 pl-4">
        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
          Especifique Centro
        </label>
        <input
          type="text"
          className={clsx(
            'w-full p-2 bg-white border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all',
            otherCenterError
              ? 'border-red-300 focus:ring-red-100'
              : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'
          )}
          value={receivingCenterOther}
          onChange={event => onReceivingCenterOtherChange(event.target.value)}
          placeholder="Nombre del centro..."
          autoFocus
        />
        {otherCenterError && (
          <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{otherCenterError}</p>
        )}
      </div>
    )}
  </div>
);
