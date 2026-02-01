import React from 'react';
import { UserMinus, UserPlus } from 'lucide-react';

interface HandoffStaffSelectorProps {
    label: string;
    type: 'delivers' | 'receives';
    bgClass?: string;
    selectedNurses: string[];
    availableNurses: string[];
    onUpdate: (updatedList: string[]) => void;
    readOnly?: boolean;
    /** Compact mode: horizontal inline layout */
    compact?: boolean;
}

export const HandoffStaffSelector: React.FC<HandoffStaffSelectorProps> = ({
    label,
    type,
    bgClass = "bg-white",
    selectedNurses = [],
    availableNurses = [],
    onUpdate,
    readOnly = false,
    compact = false
}) => {
    // Ensure we always have at least 2 slots
    const nurse1 = selectedNurses[0] || '';
    const nurse2 = selectedNurses[1] || '';

    const handleChange = (index: number, value: string) => {
        const newList = [...selectedNurses];
        if (!newList[0]) newList[0] = '';
        if (!newList[1]) newList[1] = '';

        newList[index] = value;
        onUpdate(newList);
    };

    const Icon = type === 'delivers' ? UserMinus : UserPlus;
    const iconColor = type === 'delivers' ? 'text-red-500' : 'text-green-500';

    if (compact) {
        // Compact horizontal layout - single row
        return (
            <div className={`flex items-center gap-2 ${bgClass}`}>
                <div className={`flex items-center gap-1 ${iconColor}`}>
                    <Icon size={12} />
                    <span className="text-[10px] font-bold uppercase text-slate-500 whitespace-nowrap">{label}</span>
                </div>
                <select
                    className="flex-1 text-xs py-0.5 px-1 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white min-w-[100px]"
                    value={nurse1}
                    onChange={(e) => handleChange(0, e.target.value)}
                    disabled={readOnly}
                >
                    <option value="">--</option>
                    {availableNurses.map(n => (
                        <option key={`n1-${n}`} value={n}>{n}</option>
                    ))}
                </select>
                <select
                    className="flex-1 text-xs py-0.5 px-1 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white min-w-[100px]"
                    value={nurse2}
                    onChange={(e) => handleChange(1, e.target.value)}
                    disabled={readOnly}
                >
                    <option value="">--</option>
                    {availableNurses.map(n => (
                        <option key={`n2-${n}`} value={n}>{n}</option>
                    ))}
                </select>
            </div>
        );
    }

    // Original vertical layout
    return (
        <div className={`p-3 rounded-lg border border-slate-200 ${bgClass}`}>
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-2">
                <Icon size={14} />
                {label}
            </h4>
            <div className="flex flex-col gap-2">
                <select
                    className="w-full text-xs p-1 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                    value={nurse1}
                    onChange={(e) => handleChange(0, e.target.value)}
                    disabled={readOnly}
                >
                    <option value="">-- Seleccionar --</option>
                    {availableNurses.map(n => (
                        <option key={`n1-${n}`} value={n}>{n}</option>
                    ))}
                </select>
                <select
                    className="w-full text-xs p-1 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                    value={nurse2}
                    onChange={(e) => handleChange(1, e.target.value)}
                    disabled={readOnly}
                >
                    <option value="">-- Seleccionar --</option>
                    {availableNurses.map(n => (
                        <option key={`n2-${n}`} value={n}>{n}</option>
                    ))}
                </select>
            </div>
        </div>
    );
};
