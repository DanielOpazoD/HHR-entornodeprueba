import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';

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

    const variantConfig = {
        danger: {
            icon: <AlertCircle size={18} />,
            color: 'text-red-600',
            button: 'bg-red-600 hover:bg-red-700 shadow-red-100'
        },
        warning: {
            icon: <AlertTriangle size={18} />,
            color: 'text-amber-600',
            button: 'bg-amber-600 hover:bg-amber-700 shadow-amber-100'
        },
        info: {
            icon: <Info size={18} />,
            color: 'text-blue-600',
            button: 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'
        }
    };

    const config = variantConfig[dialog.variant];

    return (
        <ConfirmDialogContext.Provider value={{ confirm, alert }}>
            {children}

            <BaseModal
                isOpen={dialog.isOpen}
                onClose={handleCancel}
                title={dialog.title}
                icon={config.icon}
                headerIconColor={config.color}
                size="sm"
                variant="white"
                showCloseButton={!dialog.isAlert}
                closeOnBackdrop={!dialog.isAlert}
            >
                <div className="space-y-6">
                    <p className="text-sm text-slate-600 leading-relaxed">
                        {dialog.message}
                    </p>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        {!dialog.isAlert && (
                            <button
                                onClick={handleCancel}
                                className="px-5 py-2 text-[11px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
                            >
                                {dialog.cancelText}
                            </button>
                        )}
                        <button
                            onClick={handleConfirm}
                            className={`px-6 py-2 text-[11px] font-black text-white uppercase tracking-widest rounded-xl shadow-lg transition-all active:scale-95 ${config.button}`}
                            autoFocus
                        >
                            {dialog.confirmText}
                        </button>
                    </div>
                </div>
            </BaseModal>
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
