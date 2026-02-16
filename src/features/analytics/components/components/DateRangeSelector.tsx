/**
 * DateRangeSelector Component
 * Allows selection of predefined date ranges or custom date range
 */

import React, { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { DateRangePreset, DATE_RANGE_LABELS } from '@/types/minsalTypes';

interface DateRangeSelectorProps {
  currentPreset: DateRangePreset;
  customStartDate?: string;
  customEndDate?: string;
  currentYearMonth?: number;
  onPresetChange: (preset: DateRangePreset) => void;
  onCustomRangeChange: (startDate: string, endDate: string) => void;
  onCurrentYearMonthChange: (month: number) => void;
}

const PRESET_OPTIONS: DateRangePreset[] = [
  'today',
  'last7days',
  'lastMonth',
  'currentMonth',
  'yearToDate',
  'last3Months',
  'last6Months',
  'last12Months',
  'custom',
];

export const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({
  currentPreset,
  customStartDate,
  customEndDate,
  currentYearMonth,
  onPresetChange,
  onCustomRangeChange,
  onCurrentYearMonthChange,
}) => {
  const [showCustom, setShowCustom] = useState(currentPreset === 'custom');
  const [localStart, setLocalStart] = useState(customStartDate || '');
  const [localEnd, setLocalEnd] = useState(customEndDate || '');

  const handlePresetClick = (preset: DateRangePreset) => {
    if (preset === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onPresetChange(preset);
    }
  };

  const handleApplyCustom = () => {
    if (localStart && localEnd) {
      onCustomRangeChange(localStart, localEnd);
    }
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const maxAvailableMonth = now.getMonth() + 1;
  const selectedCurrentYearMonth = currentYearMonth ?? maxAvailableMonth;
  const monthOptions = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ].slice(0, maxAvailableMonth);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      {/* Preset Buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESET_OPTIONS.filter(p => p !== 'custom').map(preset => (
          <button
            key={preset}
            onClick={() => handlePresetClick(preset)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              currentPreset === preset && !showCustom
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {DATE_RANGE_LABELS[preset]}
          </button>
        ))}
        <button
          onClick={() => handlePresetClick('custom')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${
            showCustom
              ? 'bg-sky-600 text-white shadow-md'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Personalizado
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showCustom ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Custom Date Range Inputs */}
      {showCustom && (
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Desde:</label>
            <input
              type="date"
              value={localStart}
              onChange={e => setLocalStart(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Hasta:</label>
            <input
              type="date"
              value={localEnd}
              onChange={e => setLocalEnd(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <button
            onClick={handleApplyCustom}
            disabled={!localStart || !localEnd}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            Aplicar
          </button>
        </div>
      )}

      {!showCustom && currentPreset === 'currentMonth' && (
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Mes ({currentYear}):</label>
            <select
              value={selectedCurrentYearMonth}
              onChange={event => onCurrentYearMonthChange(parseInt(event.target.value, 10))}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white"
            >
              {monthOptions.map((monthName, index) => {
                const monthValue = index + 1;
                return (
                  <option key={monthName} value={monthValue}>
                    {monthName}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangeSelector;
