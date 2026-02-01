import React from 'react';
import { Sun, Moon } from 'lucide-react';
import clsx from 'clsx';

interface HandoffShiftSelectorProps {
    selectedShift: 'day' | 'night';
    onShiftChange: (shift: 'day' | 'night') => void;
    schedule: {
        dayStart: string;
        dayEnd: string;
        nightStart: string;
        nightEnd: string;
        description: string;
    };
}

export const HandoffShiftSelector: React.FC<HandoffShiftSelectorProps> = ({
    selectedShift,
    onShiftChange,
    schedule
}) => {
    return (
        <div className="flex justify-center gap-3 mb-1 print:hidden">
            <button
                onClick={() => onShiftChange('day')}
                className={clsx(
                    "flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all shadow",
                    selectedShift === 'day'
                        ? "bg-sky-50 text-sky-700 border-2 border-sky-200 scale-105 shadow-sm"
                        : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
                )}
            >
                <Sun size={20} />
                Turno Largo
                <span className="text-xs font-normal opacity-80">
                    ({schedule.dayStart} - {schedule.dayEnd})
                </span>
            </button>

            <button
                onClick={() => onShiftChange('night')}
                className={clsx(
                    "flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all shadow",
                    selectedShift === 'night'
                        ? "bg-gradient-to-br from-slate-700 to-slate-900 text-white scale-105 shadow-lg shadow-slate-300"
                        : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
                )}
            >
                <Moon size={20} />
                Turno Noche
                <span className="text-xs font-normal opacity-80">
                    ({schedule.nightStart} - {schedule.nightEnd})
                </span>
            </button>
        </div>
    );
};
