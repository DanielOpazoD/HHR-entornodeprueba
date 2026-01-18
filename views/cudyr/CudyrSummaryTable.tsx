/**
 * CUDYR Summary Table Component
 * Displays category counts in a modern, minimalist format, split by UTI and Media beds.
 */

import React from 'react';
import { CategoryCounts, CudyrCategory } from '@/services/calculations/cudyrSummary';
import clsx from 'clsx';

interface CudyrSummaryTableProps {
    counts: CategoryCounts;
    utiTotal: number;
    mediaTotal: number;
}

const CATEGORIES: CudyrCategory[] = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'];

// Category color based on letter
const getCategoryStyle = (cat: CudyrCategory, count: number) => {
    const letter = cat[0];
    const hasValue = count > 0;

    const colors: Record<string, string> = {
        A: hasValue ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-300 border-slate-100',
        B: hasValue ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-300 border-slate-100',
        C: hasValue ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-slate-50 text-slate-300 border-slate-100',
        D: hasValue ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-300 border-slate-100',
    };

    return colors[letter] || 'bg-slate-50 text-slate-400';
};

interface MiniTableProps {
    title: string;
    counts: Record<CudyrCategory, number>;
    total: number;
    icon: string;
}

const MiniTable: React.FC<MiniTableProps> = ({ title, counts, total, icon }) => (
    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
                <span className="text-lg">{icon}</span>
                <span className="font-semibold text-slate-700 text-sm">{title}</span>
            </div>
            <div className={clsx(
                "px-2.5 py-1 rounded-full text-xs font-bold",
                total > 0
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-400"
            )}>
                {total}
            </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(cat => (
                <span
                    key={cat}
                    className={clsx(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all",
                        getCategoryStyle(cat, counts[cat])
                    )}
                >
                    <span className="opacity-70">{cat}</span>
                    <span>{counts[cat]}</span>
                </span>
            ))}
        </div>
    </div>
);

export const CudyrSummaryTable: React.FC<CudyrSummaryTableProps> = ({
    counts,
    utiTotal,
    mediaTotal
}) => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 print:hidden">
            <MiniTable
                title="Camas UTI"
                icon="🏥"
                counts={counts.uti}
                total={utiTotal}
            />
            <MiniTable
                title="Camas Medias"
                icon="🛏️"
                counts={counts.media}
                total={mediaTotal}
            />
        </div>
    );
};

export default CudyrSummaryTable;
