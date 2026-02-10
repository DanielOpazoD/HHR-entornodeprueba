import React from 'react';
import clsx from 'clsx';

export type MedicalBadgeVariant = 'red' | 'orange' | 'green' | 'blue' | 'slate' | 'pink' | 'purple';

interface MedicalBadgeProps {
    children: React.ReactNode;
    variant?: MedicalBadgeVariant;
    className?: string;
    pill?: boolean;
    outline?: boolean;
}

const variants: Record<MedicalBadgeVariant, string> = {
    red: 'bg-red-50 text-red-700 border-red-200 print:text-red-800 print:bg-transparent',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 print:text-orange-800 print:bg-transparent',
    green: 'bg-green-50 text-green-700 border-green-200 print:text-green-800 print:bg-transparent',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 print:text-blue-800 print:bg-transparent',
    slate: 'bg-slate-50 text-slate-600 border-slate-200 print:text-slate-700 print:bg-transparent',
    pink: 'bg-pink-50 text-pink-700 border-pink-200 print:text-pink-800 print:bg-transparent',
    purple: 'bg-purple-50 text-purple-600 border-purple-200 print:text-purple-700 print:bg-transparent',
};

const outlineVariants: Record<MedicalBadgeVariant, string> = {
    red: 'bg-transparent text-red-600 border-red-400',
    orange: 'bg-transparent text-orange-600 border-orange-400',
    green: 'bg-transparent text-green-600 border-green-400',
    blue: 'bg-transparent text-blue-600 border-blue-400',
    slate: 'bg-transparent text-slate-500 border-slate-400',
    pink: 'bg-transparent text-pink-600 border-pink-400',
    purple: 'bg-transparent text-purple-500 border-purple-400',
};

export const MedicalBadge: React.FC<MedicalBadgeProps> = ({
    children,
    variant = 'slate',
    className,
    pill = true,
    outline = false,
}) => {
    return (
        <span className={clsx(
            'inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold border transition-colors',
            pill ? 'rounded-full' : 'rounded',
            outline ? outlineVariants[variant] : variants[variant],
            'print:rounded-none print:border print:px-1 print:py-0 print:leading-tight print:text-[8px]',
            className
        )}>
            {children}
        </span>
    );
};
