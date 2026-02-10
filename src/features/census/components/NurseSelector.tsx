import React from 'react';
import { Users, Settings, Sun, Moon } from 'lucide-react';
import { useStaffContext } from '@/context/StaffContext';

interface NurseSelectorProps {
    nursesDayShift: string[];
    nursesNightShift: string[];
    nursesList: string[];
    onUpdateNurse: (shift: 'day' | 'night', index: number, name: string) => void;
    className?: string;
}

export const NurseSelector: React.FC<NurseSelectorProps> = ({
    nursesDayShift,
    nursesNightShift,
    nursesList,
    onUpdateNurse,
    className
}) => {
    const { setShowNurseManager } = useStaffContext();

    return (
        <div className={`card px-2 py-1.5 flex flex-col gap-0.5 hover:border-slate-300 transition-colors w-fit !overflow-visible ${className || ''}`}>
            <div className="flex justify-between items-center pb-0.5 border-b border-slate-100">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    <Users size={11} /> Enfermería
                </label>
                <button
                    onClick={() => setShowNurseManager(true)}
                    className="text-slate-300 hover:text-medical-600 transition-colors"
                >
                    <Settings size={11} />
                </button>
            </div>

            {/* Day Shift Row */}
            <div className="flex items-center gap-1 mt-0.5">
                <Sun size={10} className="text-amber-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">Largo</span>
                <select
                    className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-indigo-500 focus:outline-none w-[75px] bg-indigo-50/50 text-slate-700 h-[20px]"
                    value={nursesDayShift[0] || ''}
                    onChange={(e) => onUpdateNurse('day', 0, e.target.value)}
                >
                    <option value="">--</option>
                    {nursesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <select
                    className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-indigo-500 focus:outline-none w-[75px] bg-indigo-50/50 text-slate-700 h-[20px]"
                    value={nursesDayShift[1] || ''}
                    onChange={(e) => onUpdateNurse('day', 1, e.target.value)}
                >
                    <option value="">--</option>
                    {nursesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>

            {/* Night Shift Row */}
            <div className="flex items-center gap-1">
                <Moon size={10} className="text-slate-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">Noche</span>
                <select
                    className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-slate-500 focus:outline-none w-[75px] bg-slate-100/50 text-slate-700 h-[20px]"
                    value={nursesNightShift[0] || ''}
                    onChange={(e) => onUpdateNurse('night', 0, e.target.value)}
                >
                    <option value="">--</option>
                    {nursesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <select
                    className="py-0 px-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-slate-500 focus:outline-none w-[75px] bg-slate-100/50 text-slate-700 h-[20px]"
                    value={nursesNightShift[1] || ''}
                    onChange={(e) => onUpdateNurse('night', 1, e.target.value)}
                >
                    <option value="">--</option>
                    {nursesList.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </div>
    );
};
