/**
 * Notification Context
 * Provides a global notification system for displaying toasts/snackbars.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';

// ============================================================================
// Types
// ============================================================================

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = no auto-dismiss
}

interface NotificationContextType {
    notifications: Notification[];
    notify: (notification: Omit<Notification, 'id'>) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
    dismiss: (id: string) => void;
    dismissAll: () => void;
}

// ============================================================================
// Context
// ============================================================================

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = (): NotificationContextType => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
};

// ============================================================================
// Toast Component
// ============================================================================

const Toast: React.FC<{ notification: Notification; onDismiss: () => void }> = ({
    notification,
    onDismiss
}) => {
    const icons = {
        success: (
            <div className="relative">
                <CheckCircle className="text-green-500 animate-bounce-once" size={16} />
                <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-30" style={{ animationDuration: '0.5s', animationIterationCount: 1 }} />
            </div>
        ),
        error: <AlertCircle className="text-red-500" size={16} />,
        warning: <AlertTriangle className="text-amber-500" size={16} />,
        info: <Info className="text-blue-500" size={16} />
    };

    const bgColors = {
        success: 'bg-green-50 border-green-300 shadow-green-100',
        error: 'bg-red-50 border-red-300 shadow-red-100',
        warning: 'bg-amber-50 border-amber-300 shadow-amber-100',
        info: 'bg-blue-50 border-blue-300 shadow-blue-100'
    };

    const accentColors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-amber-500',
        info: 'bg-blue-500'
    };

    return (
        <div className={clsx(
            "relative flex items-start gap-3 px-3 py-2.5 rounded-lg border shadow-lg animate-slide-in-right max-w-xs overflow-hidden",
            bgColors[notification.type]
        )}>
            {/* Accent bar */}
            <div className={clsx("absolute left-0 top-0 bottom-0 w-1 rounded-l-lg", accentColors[notification.type])} />

            <div className="flex-shrink-0 mt-0.5 ml-1">
                {icons[notification.type]}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs text-slate-800 leading-tight">{notification.title}</p>
                {notification.message && (
                    <p className="text-[11px] text-slate-600 leading-tight mt-0.5">{notification.message}</p>
                )}
            </div>
            <button
                onClick={onDismiss}
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors p-0.5 hover:bg-white/50 rounded"
            >
                <X size={14} />
            </button>
        </div>
    );
};

// ============================================================================
// Provider Component
// ============================================================================

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);

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
        notify({ type: 'error', title, message, duration: 8000 }); // Errors stay longer
    }, [notify]);

    const warning = useCallback((title: string, message?: string) => {
        notify({ type: 'warning', title, message });
    }, [notify]);

    const info = useCallback((title: string, message?: string) => {
        notify({ type: 'info', title, message });
    }, [notify]);

    return (
        <NotificationContext.Provider value={{
            notifications,
            notify,
            success,
            error,
            warning,
            info,
            dismiss,
            dismissAll
        }}>
            {children}

            {/* Toast Container - Bottom Right */}
            <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-1">
                {notifications.map(notification => (
                    <Toast
                        key={notification.id}
                        notification={notification}
                        onDismiss={() => dismiss(notification.id)}
                    />
                ))}
            </div>
        </NotificationContext.Provider>
    );
};
