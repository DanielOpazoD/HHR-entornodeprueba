import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { Button } from './Button';

/**
 * Size variants for the modal container
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl' | 'full';

const sizeClasses: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '5xl': 'max-w-5xl',
    full: 'max-w-[95vw]'
};

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    icon?: React.ReactNode;
    size?: ModalSize;
    children: React.ReactNode;
    className?: string;
    closeOnBackdrop?: boolean;
    showCloseButton?: boolean;
    headerIconColor?: string;
    variant?: 'glass' | 'white';
    printable?: boolean;
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    headerActions?: React.ReactNode;
    bodyClassName?: string;
    footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    icon,
    size = 'md',
    children,
    className = '',
    closeOnBackdrop = true,
    showCloseButton = true,
    headerIconColor = 'text-medical-600',
    variant = 'glass',
    printable = false,
    initialFocusRef,
    headerActions,
    bodyClassName = '',
    footer
}) => {
    const modalRef = useRef<HTMLDivElement>(null);

    // Lock scroll when open
    useScrollLock(isOpen);

    // Handle ESC and Focus Trap
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();

            if (e.key === 'Tab' && modalRef.current) {
                const focusableElements = modalRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusableElements.length === 0) return;

                const firstElement = focusableElements[0] as HTMLElement;
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);

            // Initial focus
            setTimeout(() => {
                if (initialFocusRef?.current) {
                    initialFocusRef.current.focus();
                } else if (modalRef.current) {
                    const firstInput = modalRef.current.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') as HTMLElement;
                    if (firstInput) {
                        firstInput.focus();
                    } else {
                        const firstFocusable = modalRef.current.querySelector('button, [href], [tabindex]:not([tabindex="-1"])') as HTMLElement;
                        firstFocusable?.focus();
                    }
                }
            }, 100);
        }

        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, initialFocusRef, onClose]);

    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
            onClose();
        }
    };

    const modalContent = (
        <div
            className={`fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in ${!printable ? 'print:hidden' : ''}`}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
        >
            <div
                ref={modalRef}
                className={`flex flex-col rounded-2xl shadow-2xl w-full animate-scale-in overflow-hidden ${variant === 'white' ? 'bg-white border border-slate-200' : 'glass border border-white/40'
                    } ${sizeClasses[size]} ${className}`}
            >
                {/* Header */}
                <div className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${variant === 'white' ? 'bg-white border-slate-100' : 'bg-white/30 border-white/20'
                    }`}>
                    <h3 className="font-display font-bold text-slate-800 flex items-center gap-2 tracking-tight">
                        {icon && <span className={headerIconColor}>{icon}</span>}
                        {title}
                    </h3>
                    <div className="flex items-center gap-2">
                        {headerActions}
                        {showCloseButton && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                aria-label="Cerrar"
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <X size={18} />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Body */}
                <div className={`flex-1 overflow-y-auto ${bodyClassName || 'p-6 space-y-6'}`}>
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="p-4 border-t bg-slate-50/50 flex justify-end gap-3">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

export interface ModalSectionProps {
    title: React.ReactNode;
    icon?: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'info' | 'danger';
    className?: string;
}

const variantClasses = {
    default: { border: 'border-white/60', title: 'text-slate-800', desc: 'text-slate-600/80' },
    success: { border: 'border-emerald-200', title: 'text-emerald-800', desc: 'text-emerald-600/80' },
    warning: { border: 'border-orange-200', title: 'text-orange-800', desc: 'text-orange-600/80' },
    info: { border: 'border-blue-200', title: 'text-blue-800', desc: 'text-blue-600/80' },
    danger: { border: 'border-red-200', title: 'text-red-800', desc: 'text-red-600/80' }
};

export const ModalSection: React.FC<ModalSectionProps> = ({
    title,
    icon,
    description,
    children,
    variant = 'default',
    className = ''
}) => {
    const colors = variantClasses[variant];

    return (
        <div className={`bg-white/80 border p-4 rounded-xl shadow-sm ${colors.border} ${className}`}>
            <h4 className={`font-display font-bold flex items-center gap-2 mb-2 ${colors.title}`}>
                {icon}
                {title}
            </h4>
            {description && (
                <p className={`text-xs mb-4 leading-relaxed ${colors.desc}`}>
                    {description}
                </p>
            )}
            {children}
        </div>
    );
};
