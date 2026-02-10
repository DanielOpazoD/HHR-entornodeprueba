import React from 'react';

interface CardProps {
    children: React.ReactNode;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    headerActions?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    variant?: 'default' | 'premium' | 'glass';
    onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
    children,
    title,
    subtitle,
    icon,
    headerActions,
    footer,
    className = '',
    variant = 'premium',
    onClick
}) => {
    const variants = {
        default: 'card',
        premium: 'premium-card',
        glass: 'glass-card'
    };

    const variantStyles = variants[variant] || variants.premium;
    const clickableStyles = onClick ? 'premium-card-hover cursor-pointer' : '';

    return (
        <div
            className={`${variantStyles} ${clickableStyles} ${className}`}
            onClick={onClick}
        >
            {(title || icon || headerActions) && (
                <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        {icon && <div className="text-medical-600">{icon}</div>}
                        <div>
                            {title && <h3 className="font-display font-bold text-slate-800 leading-tight">{title}</h3>}
                            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
                        </div>
                    </div>
                    {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
                </div>
            )}

            <div className="p-4">
                {children}
            </div>

            {footer && (
                <div className="px-4 py-3 bg-slate-50/50 border-t border-slate-100">
                    {footer}
                </div>
            )}
        </div>
    );
};
