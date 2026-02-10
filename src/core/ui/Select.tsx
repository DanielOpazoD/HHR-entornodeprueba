import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    options: SelectOption[];
    error?: string;
    helperText?: string;
}

export const Select: React.FC<SelectProps> = ({
    label,
    options,
    error,
    helperText,
    className = '',
    id,
    ...props
}) => {
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
        <div className={`w-full space-y-1 ${className}`}>
            {label && (
                <label htmlFor={selectId} className="label">
                    {label}
                </label>
            )}
            <div className="relative">
                <select
                    id={selectId}
                    className={`input-field appearance-none pr-10 ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''
                        }`}
                    {...props}
                >
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <ChevronDown size={18} />
                </div>
            </div>
            {error && (
                <p className="text-xs text-red-500 font-medium animate-fade-in">{error}</p>
            )}
            {!error && helperText && (
                <p className="text-xs text-slate-400">{helperText}</p>
            )}
        </div>
    );
};
