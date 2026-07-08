/**
 * Pure orchestrator for the "save reminder" admin flow.
 *
 * Extracted from `useReminderAdmin.saveReminder` (which had grown into
 * a 115-LOC callback mixing validation, domain construction, four
 * separate use-case calls, conditional image upload, error mapping,
 * notification dispatch and local state updates). The controller keeps
 * the orchestration deterministic and side-effect-free at the React
 * boundary: it takes a submission + a context (use cases, current
 * user, current form state, now-timestamp) and returns a tagged
 * outcome. The calling hook stays thin — it owns React state, dispatch
 * to UI notifications, and the exception → user-facing-message
 * mapping that needs the real error object (`resolveReminderAdminErrorMessage`).
 *
 * This split makes the save flow exhaustively unit-testable without
 * rendering the admin screen, and gives the hook a single switch over
 * the outcome instead of nested try/catches.
 */

import {
  buildReminderFromDraft,
  validateReminderDraft,
  type ReminderDraftInput,
} from '@/domain/reminders/reminderValidation';
import type { Reminder } from '@/types/reminders';
import type { createReminderUseCases } from '@/application/reminders/reminderUseCases';

type ReminderUseCases = ReturnType<typeof createReminderUseCases>;

export type ReminderImageOutcome =
  | 'saved_without_image'
  | 'saved_with_image'
  | 'permission_denied_image_upload';

export interface ReminderAdminSaveSubmission {
  draft: ReminderDraftInput;
  imageFile: File | null;
  removeImage: boolean;
}

export interface ReminderAdminCurrentUser {
  uid?: string | null;
  displayName?: string | null;
  email?: string | null;
}

export interface ReminderAdminSaveContext {
  reminderId: string;
  formReminder: Reminder | null;
  currentUser: ReminderAdminCurrentUser | null | undefined;
  useCases: Pick<
    ReminderUseCases,
    'createReminder' | 'deleteReminderImage' | 'uploadReminderImage' | 'updateReminder'
  >;
  /** ISO timestamp captured at the start of the save attempt. */
  now: string;
}

export type ReminderAdminSaveOutcome =
  | { kind: 'invalid'; message: string }
  | { kind: 'failed_with_message'; message: string }
  | {
      kind: 'saved';
      imageOutcome: ReminderImageOutcome;
      /** Non-fatal, user-relevant warnings collected during save (e.g. an
       * old image could not be deleted but the new state was persisted). */
      warnings: string[];
    };

const resolveCreatedByName = (currentUser: ReminderAdminCurrentUser | null | undefined): string =>
  currentUser?.displayName?.trim() || currentUser?.email?.trim() || 'Jefatura';

export const executeReminderAdminSave = async (
  submission: ReminderAdminSaveSubmission,
  context: ReminderAdminSaveContext
): Promise<ReminderAdminSaveOutcome> => {
  const issues = validateReminderDraft(submission.draft);
  if (issues.length > 0) {
    return { kind: 'invalid', message: issues[0].message };
  }

  const { reminderId, formReminder, currentUser, useCases, now } = context;
  const previousImagePath = formReminder?.imagePath;
  const nextImageWasRemoved = submission.removeImage && Boolean(previousImagePath);
  const warnings: string[] = [];

  const reminder = buildReminderFromDraft(
    reminderId,
    {
      ...submission.draft,
      imageUrl: submission.removeImage ? undefined : formReminder?.imageUrl,
    },
    {
      createdBy: currentUser?.uid ?? 'system',
      createdByName: resolveCreatedByName(currentUser),
      createdAt: now,
      updatedAt: now,
    },
    formReminder
  );

  const createResult = await useCases.createReminder({
    ...reminder,
    imageUrl: submission.removeImage ? undefined : reminder.imageUrl,
    imagePath: submission.removeImage ? undefined : formReminder?.imagePath,
  });

  if (createResult.status !== 'success') {
    return {
      kind: 'failed_with_message',
      message: createResult.userSafeMessage || 'No se pudo crear el aviso.',
    };
  }

  if (nextImageWasRemoved && previousImagePath) {
    const deleteImageResult = await useCases.deleteReminderImage(previousImagePath);
    if (deleteImageResult.status !== 'success') {
      warnings.push(
        deleteImageResult.userSafeMessage || 'No se pudo eliminar la imagen del aviso.'
      );
    }
  }

  if (!submission.imageFile) {
    return { kind: 'saved', imageOutcome: 'saved_without_image', warnings };
  }

  const uploadResult = await useCases.uploadReminderImage({
    reminderId,
    file: submission.imageFile,
  });

  if (uploadResult.status !== 'success' || !uploadResult.data) {
    warnings.push(uploadResult.userSafeMessage || 'No se pudo subir la imagen del aviso.');
    return { kind: 'saved', imageOutcome: 'permission_denied_image_upload', warnings };
  }

  const updateResult = await useCases.updateReminder(reminderId, {
    imageUrl: uploadResult.data.imageUrl,
    imagePath: uploadResult.data.imagePath,
    updatedAt: new Date().toISOString(),
  });

  if (updateResult.status !== 'success') {
    return {
      kind: 'failed_with_message',
      message: updateResult.userSafeMessage || 'No se pudo actualizar el aviso.',
    };
  }

  if (previousImagePath && previousImagePath !== uploadResult.data.imagePath) {
    const previousDeleteResult = await useCases.deleteReminderImage(previousImagePath);
    if (previousDeleteResult.status !== 'success') {
      warnings.push(
        previousDeleteResult.userSafeMessage || 'No se pudo eliminar la imagen anterior del aviso.'
      );
    }
  }

  return { kind: 'saved', imageOutcome: 'saved_with_image', warnings };
};
