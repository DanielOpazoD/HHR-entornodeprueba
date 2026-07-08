import React from 'react';
import { createReminderUseCases } from '@/application/reminders/reminderUseCases';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { type ReminderDraftInput } from '@/domain/reminders/reminderValidation';
import { resolveReminderAdminErrorMessage } from '@/services/reminders/reminderErrorPolicy';
import {
  executeReminderAdminSave,
  type ReminderImageOutcome,
} from '@/features/reminders/controllers/reminderAdminSaveController';
import type { Reminder, ReminderReadReceipt } from '@/types/reminders';

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
  const { currentUser } = useAuth();
  const { success, error: notifyError } = useNotification();
  const { confirm } = useConfirmDialog();

  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const [formReminder, setFormReminder] = React.useState<Reminder | null>(null);
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [receiptsReminder, setReceiptsReminder] = React.useState<Reminder | null>(null);
  const [readReceipts, setReadReceipts] = React.useState<ReminderReadReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = React.useState(false);

  React.useEffect(() => {
    setLoadError(null);
    const unsubscribe = reminderUseCases.subscribeToReminderFeed({
      onOutcome: outcome => {
        const nextReminders = outcome.data;
        setReminders(nextReminders);
        setLoading(false);
        if (outcome.status === 'degraded' || outcome.status === 'failed') {
          setLoading(false);
          setLoadError(
            outcome.userSafeMessage ||
              outcome.issues[0]?.userSafeMessage ||
              resolveReminderAdminErrorMessage(outcome.issues[0]?.message, {
                operation: 'firestore_read',
              })
          );
        }
      },
    });
    return unsubscribe;
  }, [reminderUseCases]);

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
    [confirm, notifyError, reminderUseCases, success]
  );

  const openReadStatus = React.useCallback(
    async (reminder: Reminder) => {
      setReceiptsReminder(reminder);
      setReceiptsLoading(true);
      try {
        const result = await reminderUseCases.getReminderReadReceipts(reminder.id);
        setReadReceipts(result.data);
        if (result.status !== 'success') {
          notifyError(
            'Avisos al personal',
            result.userSafeMessage || 'No se pudo cargar el detalle de lecturas.'
          );
        }
      } finally {
        setReceiptsLoading(false);
      }
    },
    [notifyError, reminderUseCases]
  );

  const closeReadStatus = React.useCallback(() => {
    setReceiptsReminder(null);
    setReadReceipts([]);
    setReceiptsLoading(false);
  }, []);

  return {
    reminders,
    loading,
    loadError,
    processing,
    isFormOpen,
    formReminder,
    openCreateForm,
    openEditForm,
    closeForm,
    saveReminder,
    deleteReminder,
    receiptsReminder,
    readReceipts,
    receiptsLoading,
    openReadStatus,
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
