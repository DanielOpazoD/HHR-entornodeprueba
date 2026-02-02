import React from 'react';
import clsx from 'clsx';

export type MedicalButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';

interface MedicalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: MedicalButtonVariant;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    icon?: React.ReactNode;
}

const variants: Record<MedicalButtonVariant, string> = {
    primary: 'bg-medical-600 text-white hover:bg-medical-700 shadow-md shadow-medical-200/50',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    ghost: 'bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-200/50',
    success: 'bg-green-600 text-white hover:bg-green-700 shadow-md shadow-green-200/50',
    outline: 'bg-transparent text-medical-600 border border-medical-200 hover:bg-medical-50',
};

const sizes: Record<string, string> = {
    xs: 'px-2 py-1 text-[10px]',
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
};

export const MedicalButton: React.FC<MedicalButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    className,
    icon,
    disabled,
    ...props
}) => {
    return (
        <button
            disabled={disabled}
            className={clsx(
                'inline-flex items-center justify-center gap-2 font-bold uppercase tracking-wider transition-all duration-200 rounded-xl',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale',
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        >
            {icon && <span className="flex-shrink-0">{icon}</span>}
            {children}
        </button>
    );
};
