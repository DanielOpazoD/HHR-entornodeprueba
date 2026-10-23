/**
 * UI Context
 * Unified context for global UI interactions: notifications and dialogs.
 * Consolidates legacy notification/confirm flows for simpler usage.
 */

import React, { createContext, useContext, useMemo, useEffect, ReactNode } from 'react';
import type { ConfirmOptions, Notification } from '@/context/uiContracts';
import { ToastRenderer } from '@/context/ui/ToastRenderer';
import { ConfirmDialogRenderer } from '@/context/ui/ConfirmDialogRenderer';
import { useDialogController } from '@/context/ui/useDialogController';
import { useNotificationController } from '@/context/ui/useNotificationController';

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

// Toast and dialog renderers are kept inside context module boundaries.

// ============================================================================
// Provider Component
// ============================================================================

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    notifications,
    notify,
    success,
    error,
    warning,
    info,
    dismiss,
    dismissAll,
    clearAllNotificationTimers,
  } = useNotificationController();
  const {
    dialog,
    confirm,
    alert,
    handleDialogConfirm,
    handleDialogCancel,
    resolvePendingDialogAsCancelled,
  } = useDialogController();

  useEffect(() => {
    return () => {
      clearAllNotificationTimers();
      resolvePendingDialogAsCancelled();
    };
  }, [clearAllNotificationTimers, resolvePendingDialogAsCancelled]);

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
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[9999] flex max-h-[calc(100dvh-24px)] flex-col gap-2 overflow-y-auto overscroll-contain p-1 no-print sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-80 sm:max-w-[calc(100vw-32px)]">
        {notifications.map(notification => (
          <ToastRenderer
            key={notification.id}
            notification={notification}
            onDismiss={() => dismiss(notification.id)}
          />
        ))}
      </div>

      {/* Dialog */}
      <ConfirmDialogRenderer
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
