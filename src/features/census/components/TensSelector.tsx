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
        <div className={`card px-3 py-2 flex flex-col justify-between gap-2 hover:border-slate-300 transition-colors w-fit min-h-[88px] !overflow-visible ${className || ''}`}>
            <div className="flex justify-between items-center pb-1 border-b border-slate-100">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Users size={12} /> TENS
                </label>
                <button
                    onClick={() => setShowTensManager(true)}
                    className="text-slate-300 hover:text-medical-600 transition-colors"
                >
                    <Settings size={12} />
                </button>
            </div>

            {/* Day Shift - 3 slots */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase">
                    <Sun size={11} className="text-amber-500" />
                    <span>Largo</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2].map(idx => (
                        <select
                            key={`day-${idx}`}
                            className="py-0.5 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-teal-500 focus:outline-none w-[70px] bg-teal-50/50 text-slate-700 h-6"
                            value={tensDayShift[idx] || ''}
                            onChange={(e) => onUpdateTens('day', idx, e.target.value)}
                        >
                            <option value="">--</option>
                            {tensList.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    ))}
                </div>
            </div>

            {/* Night Shift - 3 slots */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase">
                    <Moon size={11} className="text-slate-500" />
                    <span>Noche</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2].map(idx => (
                        <select
                            key={`night-${idx}`}
                            className="py-0.5 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-slate-500 focus:outline-none w-[70px] bg-slate-100/50 text-slate-700 h-6"
                            value={tensNightShift[idx] || ''}
                            onChange={(e) => onUpdateTens('night', idx, e.target.value)}
                        >
                            <option value="">--</option>
                            {tensList.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    ))}
                </div>
            </div>
        </div>
    );
};
