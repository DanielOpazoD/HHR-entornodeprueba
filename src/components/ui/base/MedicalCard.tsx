import React from 'react';
import clsx from 'clsx';

interface MedicalCardProps {
    children: React.ReactNode;
    className?: string;
    hoverable?: boolean;
    compact?: boolean;
}

export const MedicalCard: React.FC<MedicalCardProps> = ({
    children,
    className,
    hoverable = false,
    compact = false,
}) => {
    return (
        <div className={clsx(
            'bg-white border border-slate-200 overflow-hidden',
            !compact && 'p-4 rounded-xl',
            compact && 'p-2 rounded-lg',
            'shadow-[0_2px_8px_rgba(0,0,0,0.04)]',
            hoverable && 'hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:border-slate-300 transition-all duration-200',
            className
        )}>
            {children}
        </div>
    );
};
