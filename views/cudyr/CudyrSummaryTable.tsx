/**
 * CUDYR Summary Table Component
 * Displays category counts in a compact format, split by UTI and Media beds.
 */

import React from 'react';
import { CategoryCounts, CudyrCategory } from '@/services/calculations/cudyrSummary';

interface CudyrSummaryTableProps {
    counts: CategoryCounts;
    utiTotal: number;
    mediaTotal: number;
}

const CATEGORY_ROWS: CudyrCategory[][] = [
    ['A1', 'A2', 'A3'],
    ['B1', 'B2', 'B3'],
    ['C1', 'C2', 'C3'],
    ['D1', 'D2', 'D3']
];

interface MiniTableProps {
    title: string;
    counts: Record<CudyrCategory, number>;
    total: number;
    colorClass: string;
    badgeColorClass: string;
}

const MiniTable: React.FC<MiniTableProps> = ({ title, counts, total, colorClass, badgeColorClass }) => (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
        <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{title}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeColorClass}`}>
                Total: {total}
            </span>
        </div>
        <div className="space-y-1 text-xs font-mono">
            {CATEGORY_ROWS.map((row, idx) => (
                <div key={idx} className="flex gap-3">
                    {row.map(cat => (
                        <span key={cat} className="whitespace-nowrap">
                            {cat}=<strong>{counts[cat]}</strong>
                        </span>
                    ))}
                </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 print:hidden">
            <MiniTable
                title="UTI"
                counts={counts.uti}
                total={utiTotal}
                colorClass="bg-blue-50 border-blue-200"
                badgeColorClass="bg-blue-600 text-white"
            />
            <MiniTable
                title="Medias"
                counts={counts.media}
                total={mediaTotal}
                colorClass="bg-amber-50 border-amber-200"
                badgeColorClass="bg-amber-600 text-white"
            />
        </div>
    );
};

export default CudyrSummaryTable;
