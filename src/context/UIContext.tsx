/**
 * UI Context
 * Unified context for global UI interactions: notifications and dialogs.
 * Consolidates NotificationContext and ConfirmDialogContext for simpler usage.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Toast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { ConfirmOptions, DialogState, Notification } from '@/context/uiContracts';

// ============================================================================
// Types
// ============================================================================

export type {
  ConfirmOptions,
  DialogState,
  Notification,
  NotificationType,
} from '@/context/uiContracts';

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

// Toast and Dialog components moved to components/ui/

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
    resolve: null,
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

  const notify = useCallback(
    (notification: Omit<Notification, 'id'>) => {
      const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const duration = notification.duration ?? 5000;

      setNotifications(prev => [...prev, { ...notification, id }]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const success = useCallback(
    (title: string, message?: string) => {
      notify({ type: 'success', title, message });
    },
    [notify]
  );

  const error = useCallback(
    (title: string, message?: string) => {
      notify({ type: 'error', title, message, duration: 8000 });
    },
    [notify]
  );

  const warning = useCallback(
    (title: string, message?: string) => {
      notify({ type: 'warning', title, message });
    },
    [notify]
  );

  const info = useCallback(
    (title: string, message?: string) => {
      notify({ type: 'info', title, message });
    },
    [notify]
  );

  // ========================================================================
  // Dialog Actions
  // ========================================================================

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setDialog({
        isOpen: true,
        title: options.title || 'Confirmar acción',
        message: options.message,
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        variant: options.variant || 'warning',
        isAlert: false,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((message: string, title?: string): Promise<void> => {
    return new Promise(resolve => {
      setDialog({
        isOpen: true,
        title: title || 'Aviso',
        message,
        confirmText: 'Aceptar',
        cancelText: '',
        variant: 'info',
        isAlert: true,
        resolve: () => resolve(),
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

  const contextValue = useMemo<UIContextType>(
    () => ({
      // Notifications
      notifications,
      notify,
      success,
      error,
      warning,
      info,
      dismiss,
      dismissAll,
      // Dialogs
      confirm,
      alert,
    }),
    [notifications, notify, success, error, warning, info, dismiss, dismissAll, confirm, alert]
  );

  return (
    <UIContext.Provider value={contextValue}>
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
      <ConfirmDialog
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
