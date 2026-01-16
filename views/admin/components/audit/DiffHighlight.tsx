import React from 'react';
import { computeWordDiff } from '@/services/admin/utils/diffUtils';
import clsx from 'clsx';

interface DiffHighlightProps {
    oldValue: any;
    newValue: any;
    className?: string;
}

export const DiffHighlight: React.FC<DiffHighlightProps> = ({ oldValue, newValue, className }) => {
    // If not strings, just show as blocks
    if (typeof oldValue !== 'string' || typeof newValue !== 'string') {
        return (
            <div className={clsx("flex flex-wrap gap-2", className)}>
                <span className="text-rose-600 line-through bg-rose-50 px-1 rounded truncate max-w-[200px]">
                    {String(oldValue ?? 'N/A')}
                </span>
                <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded truncate max-w-[200px]">
                    {String(newValue ?? 'N/A')}
                </span>
            </div>
        );
    }

    const diff = computeWordDiff(oldValue, newValue);

    return (
        <div className={clsx("font-sans leading-relaxed text-[11px] bg-slate-50/50 p-2 rounded-lg border border-slate-100", className)}>
            {diff.map((part, index) => (
                <span
                    key={index}
                    className={clsx(
                        part.added && "text-emerald-700 bg-emerald-100/50 font-bold px-0.5 rounded",
                        part.removed && "text-rose-700 bg-rose-100/30 line-through px-0.5 rounded opacity-70",
                        !part.added && !part.removed && "text-slate-600"
                    )}
                >
                    {part.value}
                </span>
            ))}
        </div>
    );
};
