import React from 'react';
import { createReminderUseCases } from '@/application/reminders/reminderUseCases';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { type ReminderDraftInput } from '@/features/reminders/domain/reminderValidation';
import { resolveReminderAdminErrorMessage } from '@/services/reminders/reminderErrorPolicy';
import {
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/session/authoringSession';
import { onSessionChange } from '@/services/session/sessionStorageTransition';
import {
  executeReminderAdminSave,
  type ReminderImageOutcome,
} from '@/features/reminders/controllers/reminderAdminSaveController';
import type { Reminder, ReminderReadReceipt } from '@/types/reminders';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const DEFAULT_READ_RECEIPTS_ERROR = 'No fue posible cargar el detalle de lecturas del aviso.';
const FEED_RECONNECT_DELAYS_MS = [1000, 2500, 5000, 10000, 20000] as const;

const buildReminderId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `reminder-${crypto.randomUUID()}`;
  }
  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface ReminderAdminSubmission {
  draft: ReminderDraftInput;
  imageFile: File | null;
  removeImage: boolean;
}

type ReminderSaveResult = ReminderImageOutcome;

export const useReminderAdmin = () => {
  const reminderUseCases = React.useMemo(() => createReminderUseCases(), []);
  const { currentUser, role } = useAuth();
  const { success, error: notifyError } = useNotification();
  const { confirm } = useConfirmDialog();

  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [feedReloadAttempt, setFeedReloadAttempt] = React.useState(0);
  const [processing, setProcessing] = React.useState(false);
  const [formReminder, setFormReminder] = React.useState<Reminder | null>(null);
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [receiptsReminder, setReceiptsReminder] = React.useState<Reminder | null>(null);
  const [readReceipts, setReadReceipts] = React.useState<ReminderReadReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [receiptsError, setReceiptsError] = React.useState<string | null>(null);

  const isMountedRef = React.useRef(true);
  const readStatusRequestIdRef = React.useRef(0);
  const receiptsReminderRef = React.useRef<Reminder | null>(null);
  const activeReadStatusSessionRef = React.useRef<AuthoringSessionGuard | null>(null);
  const hasConfirmedFeedRef = React.useRef(false);
  const confirmedReminderIdsRef = React.useRef<Set<string>>(new Set());
  const feedTerminatedRef = React.useRef(false);
  const autoReconnectCountRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const currentUserUid = currentUser?.uid ?? null;
  const currentUserUidRef = React.useRef<string | null>(currentUserUid);

  const clearScheduledReconnect = React.useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const activeReceiptsReminder = React.useMemo(() => {
    if (!receiptsReminder) return null;
    return reminders.find(item => item.id === receiptsReminder.id) ?? receiptsReminder;
  }, [receiptsReminder, reminders]);

  const closeReadStatus = React.useCallback(() => {
    readStatusRequestIdRef.current += 1;
    activeReadStatusSessionRef.current = null;
    receiptsReminderRef.current = null;
    setReceiptsReminder(null);
    setReadReceipts([]);
    setReceiptsError(null);
    setReceiptsLoading(false);
  }, []);

  const triggerFeedReconnect = React.useCallback(
    ({ manual = false }: { manual?: boolean } = {}) => {
      clearScheduledReconnect();
      if (manual) {
        autoReconnectCountRef.current = 0;
        if (!hasConfirmedFeedRef.current) {
          setLoading(true);
        }
      }
      setFeedReloadAttempt(current => current + 1);
    },
    [clearScheduledReconnect]
  );

  const retryLoadReminders = React.useCallback(() => {
    triggerFeedReconnect({ manual: true });
  }, [triggerFeedReconnect]);

  if (useChangedOnRender([reminderUseCases])) setLoadError(null);
  if (useChangedOnRender([currentUserUid])) {
    setReminders([]);
    setLoading(true);
    setLoadError(null);
    setReceiptsReminder(null);
    setReadReceipts([]);
    setReceiptsError(null);
    setReceiptsLoading(false);
  }

  React.useLayoutEffect(() => {
    const previousUid = currentUserUidRef.current;
    currentUserUidRef.current = currentUserUid;
    if (previousUid !== currentUserUid) {
      readStatusRequestIdRef.current += 1;
      activeReadStatusSessionRef.current = null;
      receiptsReminderRef.current = null;
      hasConfirmedFeedRef.current = false;
      confirmedReminderIdsRef.current = new Set();
      feedTerminatedRef.current = false;
      autoReconnectCountRef.current = 0;
      clearScheduledReconnect();
    }
  }, [clearScheduledReconnect, currentUserUid]);

  React.useEffect(() => {
    receiptsReminderRef.current = activeReceiptsReminder;
  }, [activeReceiptsReminder]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      readStatusRequestIdRef.current += 1;
      activeReadStatusSessionRef.current = null;
      clearScheduledReconnect();
    };
  }, [clearScheduledReconnect]);

  React.useEffect(() => {
    const handleSessionBoundaryChange = () => {
      const activeSession = activeReadStatusSessionRef.current;
      if (activeSession && !activeSession.isCurrent()) {
        closeReadStatus();
      }
      if (feedTerminatedRef.current && guardAuthoringSession().isCurrent()) {
        triggerFeedReconnect({ manual: true });
      }
    };
    const handleRecoverySignal = () => {
      if (
        feedTerminatedRef.current &&
        (typeof document === 'undefined' || document.visibilityState !== 'hidden') &&
        guardAuthoringSession().isCurrent()
      ) {
        triggerFeedReconnect({ manual: true });
      }
    };
    const unsubscribeSession = onSessionChange(handleSessionBoundaryChange);
    window.addEventListener('storage', handleSessionBoundaryChange);
    window.addEventListener('online', handleRecoverySignal);
    window.addEventListener('focus', handleRecoverySignal);
    document.addEventListener('visibilitychange', handleRecoverySignal);
    return () => {
      unsubscribeSession();
      window.removeEventListener('storage', handleSessionBoundaryChange);
      window.removeEventListener('online', handleRecoverySignal);
      window.removeEventListener('focus', handleRecoverySignal);
      document.removeEventListener('visibilitychange', handleRecoverySignal);
    };
  }, [closeReadStatus, triggerFeedReconnect]);

  React.useEffect(() => {
    const authoringSession = guardAuthoringSession();
    const startedUserUid = currentUserUidRef.current;
    let active = true;

    const unsubscribe = reminderUseCases.subscribeToReminderFeed({
      onOutcome: outcome => {
        if (!active || !isMountedRef.current || currentUserUidRef.current !== startedUserUid) {
          return;
        }
        const nextReminders = outcome.data;
        setLoading(false);

        if (outcome.status === 'degraded' || outcome.status === 'failed') {
          if (nextReminders.length > 0) {
            setReminders(nextReminders);
          }
          setLoadError(
            outcome.userSafeMessage ||
              outcome.issues[0]?.userSafeMessage ||
              resolveReminderAdminErrorMessage(outcome.issues[0]?.message, {
                operation: 'firestore_read',
              })
          );

          if (outcome.reason !== 'unconfirmed_cache') {
            feedTerminatedRef.current = true;
            const retryIndex = autoReconnectCountRef.current;
            if (
              retryIndex < FEED_RECONNECT_DELAYS_MS.length &&
              reconnectTimerRef.current === null &&
              authoringSession.isCurrent()
            ) {
              const delayMs = FEED_RECONNECT_DELAYS_MS[retryIndex];
              autoReconnectCountRef.current = retryIndex + 1;
              reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                if (
                  isMountedRef.current &&
                  currentUserUidRef.current === startedUserUid &&
                  authoringSession.isCurrent()
                ) {
                  setFeedReloadAttempt(current => current + 1);
                }
              }, delayMs);
            }
          }
          return;
        }

        feedTerminatedRef.current = false;
        autoReconnectCountRef.current = 0;
        clearScheduledReconnect();
        hasConfirmedFeedRef.current = true;
        confirmedReminderIdsRef.current = new Set(nextReminders.map(item => item.id));
        setReminders(nextReminders);
        setLoadError(null);

        const activeReminder = receiptsReminderRef.current;
        if (activeReminder && !confirmedReminderIdsRef.current.has(activeReminder.id)) {
          closeReadStatus();
        }
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    clearScheduledReconnect,
    closeReadStatus,
    currentUserUid,
    feedReloadAttempt,
    reminderUseCases,
    role,
  ]);

  const openCreateForm = React.useCallback(() => {
    setFormReminder(null);
    setIsFormOpen(true);
  }, []);

  const openEditForm = React.useCallback((reminder: Reminder) => {
    setFormReminder(reminder);
    setIsFormOpen(true);
  }, []);

  const closeForm = React.useCallback(() => {
    if (processing) return;
    setIsFormOpen(false);
    setFormReminder(null);
  }, [processing]);

  const saveReminder = React.useCallback(
    async (submission: ReminderAdminSubmission) => {
      const reminderId = formReminder?.id ?? buildReminderId();
      const now = new Date().toISOString();

      setProcessing(true);
      try {
        const outcome = await executeReminderAdminSave(submission, {
          reminderId,
          formReminder,
          currentUser,
          useCases: reminderUseCases,
          now,
        });

        if (outcome.kind === 'invalid') {
          notifyError('Avisos al personal', outcome.message);
          return false;
        }

        if (outcome.kind === 'failed_with_message') {
          notifyError('Avisos al personal', outcome.message);
          return false;
        }

        for (const warning of outcome.warnings) {
          notifyError('Avisos al personal', warning);
        }
        success('Avisos al personal', resolveSaveResultMessage(formReminder, outcome.imageOutcome));
        setIsFormOpen(false);
        setFormReminder(null);
        return true;
      } catch (error) {
        notifyError(
          'Avisos al personal',
          resolveReminderAdminErrorMessage(error, { operation: 'firestore_write' })
        );
        return false;
      } finally {
        setProcessing(false);
      }
    },
    [currentUser, formReminder, notifyError, reminderUseCases, success]
  );

  const deleteReminder = React.useCallback(
    async (reminder: Reminder) => {
      const accepted = await confirm({
        title: 'Eliminar aviso',
        message: `Se eliminará "${reminder.title}" y sus lecturas asociadas dejarán de estar disponibles.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        variant: 'warning',
      });

      if (!accepted) return;

      setProcessing(true);
      try {
        const removeResult = await reminderUseCases.deleteReminder(reminder.id);
        if (removeResult.status !== 'success') {
          throw new Error(removeResult.userSafeMessage || 'No se pudo eliminar el aviso.');
        }
        await reminderUseCases.deleteReminderImage(reminder.imagePath);
        if (receiptsReminderRef.current?.id === reminder.id) {
          closeReadStatus();
        }
        success('Avisos al personal', 'El aviso fue eliminado.');
      } catch (error) {
        notifyError(
          'Avisos al personal',
          error instanceof Error ? error.message : 'No se pudo eliminar el aviso.'
        );
      } finally {
        setProcessing(false);
      }
    },
    [closeReadStatus, confirm, notifyError, reminderUseCases, success]
  );

  const openReadStatus = React.useCallback(
    async (reminder: Reminder) => {
      const authoringSession = guardAuthoringSession();
      if (!authoringSession.isCurrent()) {
        closeReadStatus();
        return;
      }
      if (hasConfirmedFeedRef.current && !confirmedReminderIdsRef.current.has(reminder.id)) {
        closeReadStatus();
        return;
      }

      const startedUserUid = currentUserUidRef.current;
      const requestId = ++readStatusRequestIdRef.current;
      activeReadStatusSessionRef.current = authoringSession;
      receiptsReminderRef.current = reminder;
      setReceiptsReminder(reminder);
      setReadReceipts([]);
      setReceiptsError(null);
      setReceiptsLoading(true);

      const isActiveRequest = (): boolean =>
        isMountedRef.current && readStatusRequestIdRef.current === requestId;

      const isSessionStillValid = (): boolean =>
        currentUserUidRef.current === startedUserUid && authoringSession.isCurrent();

      try {
        const result = await reminderUseCases.getReminderReadReceipts(reminder.id);
        if (!isActiveRequest()) return;
        if (!isSessionStillValid()) {
          closeReadStatus();
          return;
        }

        if (result.status !== 'success') {
          const message =
            result.userSafeMessage ||
            result.issues[0]?.userSafeMessage ||
            DEFAULT_READ_RECEIPTS_ERROR;
          setReadReceipts([]);
          setReceiptsError(message);
          notifyError('Avisos al personal', message);
          return;
        }

        setReadReceipts(result.data);
        setReceiptsError(null);
        if (feedTerminatedRef.current) {
          triggerFeedReconnect({ manual: true });
        }
      } catch (error) {
        if (!isActiveRequest()) return;
        if (!isSessionStillValid()) {
          closeReadStatus();
          return;
        }
        const message =
          resolveReminderAdminErrorMessage(error, { operation: 'firestore_read' }) ||
          DEFAULT_READ_RECEIPTS_ERROR;
        setReadReceipts([]);
        setReceiptsError(message);
        notifyError('Avisos al personal', message);
      } finally {
        if (isActiveRequest() && isSessionStillValid()) {
          setReceiptsLoading(false);
        }
      }
    },
    [closeReadStatus, notifyError, reminderUseCases, triggerFeedReconnect]
  );

  const retryReadStatus = React.useCallback(() => {
    const activeReminder = receiptsReminderRef.current;
    if (!activeReminder) return;
    void openReadStatus(activeReminder);
  }, [openReadStatus]);

  return {
    reminders,
    loading,
    loadError,
    retryLoadReminders,
    processing,
    isFormOpen,
    formReminder,
    openCreateForm,
    openEditForm,
    closeForm,
    saveReminder,
    deleteReminder,
    receiptsReminder: activeReceiptsReminder,
    readReceipts,
    receiptsLoading,
    receiptsError,
    openReadStatus,
    retryReadStatus,
    closeReadStatus,
  };
};

const resolveSaveResultMessage = (
  formReminder: Reminder | null,
  result: ReminderSaveResult
): string => {
  if (result === 'saved_with_image') {
    return formReminder
      ? 'El aviso fue actualizado con su imagen.'
      : 'El aviso fue creado con su imagen.';
  }

  if (result === 'permission_denied_image_upload') {
    return formReminder
      ? 'El aviso fue actualizado, pero la imagen no pudo subirse.'
      : 'El aviso fue creado, pero la imagen no pudo subirse.';
  }
  return formReminder ? 'El aviso fue actualizado.' : 'El aviso fue creado.';
};
