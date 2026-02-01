import React from 'react';
import { UserMinus, UserPlus } from 'lucide-react';

interface HandoffStaffDisplayProps {
    label: string;
    type: 'delivers' | 'receives';
    nurses: string[];
    /** Compact mode: horizontal inline layout */
    compact?: boolean;
}

/**
 * Read-only display for nurse names inherited from the daily census.
 * This differs from HandoffStaffSelector in that it does NOT render dropdowns,
 * avoiding user confusion when values are not editable from this view.
 */
export const HandoffStaffDisplay: React.FC<HandoffStaffDisplayProps> = ({
    label,
    type,
    nurses = [],
    compact = false
}) => {
    const Icon = type === 'delivers' ? UserMinus : UserPlus;
    const iconColor = type === 'delivers' ? 'text-red-500' : 'text-green-500';

    const nurse1 = nurses[0] || '—';
    const nurse2 = nurses[1] || '';

    if (compact) {
        return (
            <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1 ${iconColor}`}>
                    <Icon size={12} />
                    <span className="text-[10px] font-bold uppercase text-slate-500 whitespace-nowrap">{label}</span>
                </div>
                <span className="text-xs text-slate-700 font-medium">
                    {nurse1}{nurse2 && `, ${nurse2}`}
                </span>
            </div>
        );
    }

    // Original vertical layout (non-compact)
    return (
        <div className="p-3 rounded-lg border border-slate-200 bg-white">
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-2">
                <Icon size={14} />
                {label}
            </h4>
            <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-700">{nurse1}</span>
                {nurse2 && <span className="text-sm text-slate-700">{nurse2}</span>}
            </div>
        </div>
    );
};
