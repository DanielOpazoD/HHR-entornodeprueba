/**
 * UI Context
 * Unified context for global UI interactions: notifications and dialogs.
 * Consolidates NotificationContext and ConfirmDialogContext for simpler usage.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';
import { useScrollLock } from '../hooks/useScrollLock';

// ============================================================================
// Types
// ============================================================================

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message?: string;
    duration?: number;
}

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
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

// Combined context type
export interface UIContextType {
    // Notifications
    notifications: Notification[];
    notify: (notification: Omit<Notification, 'id'>) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
    dismiss: (id: string) => void;
    dismissAll: () => void;

    // Dialogs
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    alert: (message: string, title?: string) => Promise<void>;
}

// ============================================================================
// Context
// ============================================================================

const UIContext = createContext<UIContextType | undefined>(undefined);

export const useUI = (): UIContextType => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};

// Backward compatibility aliases
export const useNotification = useUI;
export const useConfirmDialog = useUI;

// ============================================================================
// Toast Component
// ============================================================================

const Toast: React.FC<{ notification: Notification; onDismiss: () => void }> = ({
    notification,
    onDismiss
}) => {
    const icons = {
        success: <CheckCircle className="text-green-500" size={12} />,
        error: <AlertCircle className="text-red-500" size={12} />,
        warning: <AlertTriangle className="text-amber-500" size={12} />,
        info: <Info className="text-blue-500" size={12} />
    };

    const bgColors = {
        success: 'bg-green-50 border-green-200',
        error: 'bg-red-50 border-red-200',
        warning: 'bg-amber-50 border-amber-200',
        info: 'bg-blue-50 border-blue-200'
    };

    return (
        <div className={clsx(
            "flex items-start gap-2 px-2 py-1.5 rounded border shadow-md animate-slide-in-right max-w-[200px]",
            bgColors[notification.type]
        )}>
            <div className="flex-shrink-0 mt-0.5">
                {icons[notification.type]}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-medium text-[10px] text-slate-800 leading-tight">{notification.title}</p>
                {notification.message && (
                    <p className="text-[9px] text-slate-500 leading-tight">{notification.message}</p>
                )}
            </div>
            <button
                onClick={onDismiss}
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
            >
                <X size={10} />
            </button>
        </div>
    );
};

// ============================================================================
// Dialog Component
// ============================================================================

const Dialog: React.FC<{
    dialog: DialogState;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ dialog, onConfirm, onCancel }) => {
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

    // Manage body scroll lock
    useScrollLock(dialog.isOpen);

    if (!dialog.isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-fade-in"
            onClick={(e) => {
                if (e.target === e.currentTarget && !dialog.isAlert) {
                    onCancel();
                }
            }}
        >
            <div
                className={`bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden border ${styles.border} animate-scale-in`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={`px-4 py-2 ${styles.bg} border-b ${styles.border} flex items-center gap-2`}>
                    <AlertTriangle className={styles.icon} size={16} />
                    <h3 className="font-semibold text-sm text-slate-800">{dialog.title}</h3>
                    {!dialog.isAlert && (
                        <button
                            onClick={onCancel}
                            className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="px-4 py-3">
                    <p className="text-xs text-slate-600 whitespace-pre-line">{dialog.message}</p>
                </div>
                <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                    {!dialog.isAlert && (
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition-colors font-medium"
                        >
                            {dialog.cancelText}
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${styles.button}`}
                        autoFocus
                    >
                        {dialog.confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// Provider Component
// ============================================================================

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Notifications state
    const [notifications, setNotifications] = useState<Notification[]>([]);

    // Dialog state
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

    // ========================================================================
    // Notification Actions
    // ========================================================================

    const dismiss = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const dismissAll = useCallback(() => {
        setNotifications([]);
    }, []);

    const notify = useCallback((notification: Omit<Notification, 'id'>) => {
        const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const duration = notification.duration ?? 5000;

        setNotifications(prev => [...prev, { ...notification, id }]);

        if (duration > 0) {
            setTimeout(() => dismiss(id), duration);
        }
    }, [dismiss]);

    const success = useCallback((title: string, message?: string) => {
        notify({ type: 'success', title, message });
    }, [notify]);

    const error = useCallback((title: string, message?: string) => {
        notify({ type: 'error', title, message, duration: 8000 });
    }, [notify]);

    const warning = useCallback((title: string, message?: string) => {
        notify({ type: 'warning', title, message });
    }, [notify]);

    const info = useCallback((title: string, message?: string) => {
        notify({ type: 'info', title, message });
    }, [notify]);

    // ========================================================================
    // Dialog Actions
    // ========================================================================

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

    const handleDialogConfirm = () => {
        if (dialog.resolve) {
            dialog.resolve(true);
        }
        setDialog(prev => ({ ...prev, isOpen: false, resolve: null }));
    };

    const handleDialogCancel = () => {
        if (dialog.resolve) {
            dialog.resolve(false);
        }
        setDialog(prev => ({ ...prev, isOpen: false, resolve: null }));
    };

    // ========================================================================
    // Render
    // ========================================================================

    return (
        <UIContext.Provider value={{
            // Notifications
            notifications, notify, success, error, warning, info, dismiss, dismissAll,
            // Dialogs
            confirm, alert
        }}>
            {children}

            {/* Toast Container */}
            <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-1">
                {notifications.map(notification => (
                    <Toast
                        key={notification.id}
                        notification={notification}
                        onDismiss={() => dismiss(notification.id)}
                    />
                ))}
            </div>

            {/* Dialog */}
            <Dialog
                dialog={dialog}
                onConfirm={handleDialogConfirm}
                onCancel={handleDialogCancel}
            />
        </UIContext.Provider>
    );
};

// Backward compatibility: export aliases for existing imports
export const NotificationProvider = UIProvider;
export const ConfirmDialogProvider = UIProvider;
