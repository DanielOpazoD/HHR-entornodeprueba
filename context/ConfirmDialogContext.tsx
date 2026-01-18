import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

// --- Types ---

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmDialogContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    alert: (message: string, title?: string) => Promise<void>;
}

// --- Context ---

const ConfirmDialogContext = createContext<ConfirmDialogContextType | undefined>(undefined);

// --- Provider ---

interface ConfirmDialogProviderProps {
    children: ReactNode;
}

interface DialogState {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    variant: 'danger' | 'warning' | 'info';
    isAlert: boolean;
    resolve: ((value: boolean) => void) | null;
}

export const ConfirmDialogProvider: React.FC<ConfirmDialogProviderProps> = ({ children }) => {
    const [dialog, setDialog] = useState<DialogState>({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        variant: 'warning',
        isAlert: false,
        resolve: null
    });

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setDialog({
                isOpen: true,
                title: options.title || 'Confirmar acción',
                message: options.message,
                confirmText: options.confirmText || 'Confirmar',
                cancelText: options.cancelText || 'Cancelar',
                variant: options.variant || 'warning',
                isAlert: false,
                resolve
            });
        });
    }, []);

    const alert = useCallback((message: string, title?: string): Promise<void> => {
        return new Promise((resolve) => {
            setDialog({
                isOpen: true,
                title: title || 'Aviso',
                message,
                confirmText: 'Aceptar',
                cancelText: '',
                variant: 'info',
                isAlert: true,
                resolve: () => resolve()
            });
        });
    }, []);

    const handleConfirm = () => {
        if (dialog.resolve) {
            dialog.resolve(true);
        }
        setDialog(prev => ({ ...prev, isOpen: false, resolve: null }));
    };

    const handleCancel = () => {
        if (dialog.resolve) {
            dialog.resolve(false);
        }
        setDialog(prev => ({ ...prev, isOpen: false, resolve: null }));
    };

    const variantStyles = {
        danger: {
            icon: 'text-red-600',
            bg: 'bg-red-50',
            border: 'border-red-200',
            button: 'bg-red-600 hover:bg-red-700 text-white'
        },
        warning: {
            icon: 'text-amber-600',
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            button: 'bg-amber-600 hover:bg-amber-700 text-white'
        },
        info: {
            icon: 'text-blue-600',
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            button: 'bg-blue-600 hover:bg-blue-700 text-white'
        }
    };

    const styles = variantStyles[dialog.variant];

    return (
        <ConfirmDialogContext.Provider value={{ confirm, alert }}>
            {children}

            {/* Dialog Overlay */}
            {dialog.isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !dialog.isAlert) {
                            handleCancel();
                        }
                    }}
                >
                    <div
                        className={`bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden border ${styles.border} animate-scale-in`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className={`px-4 py-2 ${styles.bg} border-b ${styles.border} flex items-center gap-2`}>
                            <AlertTriangle className={styles.icon} size={16} />
                            <h3 className="font-semibold text-sm text-slate-800">{dialog.title}</h3>
                            {!dialog.isAlert && (
                                <button
                                    onClick={handleCancel}
                                    className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        {/* Body */}
                        <div className="px-4 py-3">
                            <p className="text-xs text-slate-600 whitespace-pre-line">{dialog.message}</p>
                        </div>

                        {/* Footer */}
                        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                            {!dialog.isAlert && (
                                <button
                                    onClick={handleCancel}
                                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition-colors font-medium"
                                >
                                    {dialog.cancelText}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${styles.button}`}
                                autoFocus
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmDialogContext.Provider>
    );
};

// --- Hook ---

export const useConfirmDialog = (): ConfirmDialogContextType => {
    const context = useContext(ConfirmDialogContext);
    if (!context) {
        throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
    }
    return context;
};
