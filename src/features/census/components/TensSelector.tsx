import React from 'react';
import { Users, Settings, Sun, Moon } from 'lucide-react';
import { useStaffContext } from '@/context/StaffContext';

interface TensSelectorProps {
    tensDayShift: string[];
    tensNightShift: string[];
    tensList: string[];
    onUpdateTens: (shift: 'day' | 'night', index: number, name: string) => void;
    className?: string;
}

export const TensSelector: React.FC<TensSelectorProps> = ({
    tensDayShift,
    tensNightShift,
    tensList,
    onUpdateTens,
    className
}) => {
    const { setShowTensManager } = useStaffContext();

    return (
        <div className={`card px-2 py-1.5 flex flex-col gap-0.5 hover:border-slate-300 transition-colors w-fit !overflow-visible ${className || ''}`}>
            <div className="flex justify-between items-center pb-0.5 border-b border-slate-100">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Users size={11} /> TENS
                </label>
                <button
                    onClick={() => setShowTensManager(true)}
                    className="text-slate-300 hover:text-medical-600 transition-colors"
                >
                    <Settings size={11} />
                </button>
            </div>

            {/* Day Shift Row */}
            <div className="flex items-center gap-1 mt-0.5">
                <Sun size={10} className="text-amber-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">Largo</span>
                {[0, 1, 2].map(idx => (
                    <select
                        key={`day-${idx}`}
                        className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-teal-500 focus:outline-none w-[60px] bg-teal-50/50 text-slate-700 h-[20px]"
                        value={tensDayShift[idx] || ''}
                        onChange={(e) => onUpdateTens('day', idx, e.target.value)}
                    >
                        <option value="">--</option>
                        {tensList.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                ))}
            </div>

            {/* Night Shift Row */}
            <div className="flex items-center gap-1">
                <Moon size={10} className="text-slate-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">Noche</span>
                {[0, 1, 2].map(idx => (
                    <select
                        key={`night-${idx}`}
                        className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-slate-500 focus:outline-none w-[60px] bg-slate-100/50 text-slate-700 h-[20px]"
                        value={tensNightShift[idx] || ''}
                        onChange={(e) => onUpdateTens('night', idx, e.target.value)}
                    >
                        <option value="">--</option>
                        {tensList.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                ))}
            </div>
        </div>
    );
};
