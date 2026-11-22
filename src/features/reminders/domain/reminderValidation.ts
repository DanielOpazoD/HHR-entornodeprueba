import type { Reminder, ReminderShift, ReminderType } from '@/types/reminders';
import type { UserRole } from '@/types/authRoleTypes';

export interface ReminderDraftInput {
  title: string;
  message: string;
  imageUrl?: string;
  type: ReminderType;
  targetRoles: UserRole[];
  targetShifts: ReminderShift[];
  startDate: string;
  endDate: string;
  priority: number;
  isActive: boolean;
}

export interface ReminderValidationIssue {
  field: string;
  message: string;
}

export const validateReminderDraft = (draft: ReminderDraftInput): ReminderValidationIssue[] => {
  const issues: ReminderValidationIssue[] = [];

  if (!draft.title.trim()) {
    issues.push({ field: 'title', message: 'El título es obligatorio.' });
  }
  if (!draft.message.trim()) {
    issues.push({ field: 'message', message: 'El mensaje es obligatorio.' });
  }
  if (draft.targetRoles.length === 0) {
    issues.push({ field: 'targetRoles', message: 'Selecciona al menos un rol destinatario.' });
  }
  if (draft.targetShifts.length === 0) {
    issues.push({ field: 'targetShifts', message: 'Selecciona al menos un turno.' });
  }
  if (!draft.startDate || !draft.endDate) {
    issues.push({ field: 'dateRange', message: 'Debes indicar inicio y fin de vigencia.' });
  } else if (draft.startDate > draft.endDate) {
    issues.push({
      field: 'dateRange',
      message: 'La fecha de inicio no puede ser posterior a la fecha de término.',
    });
  }
  if (draft.priority < 1 || draft.priority > 3) {
    issues.push({ field: 'priority', message: 'La prioridad debe estar entre 1 y 3.' });
  }

  return issues;
};

export const buildReminderFromDraft = (
  id: string,
  draft: ReminderDraftInput,
  metadata: Pick<Reminder, 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'>,
  previous?: Reminder | null
): Reminder => ({
  id,
  title: draft.title.trim(),
  message: draft.message.trim(),
  imageUrl: draft.imageUrl?.trim() || previous?.imageUrl,
  imagePath: previous?.imagePath,
  type: draft.type,
  targetRoles: draft.targetRoles,
  targetShifts: draft.targetShifts,
  startDate: draft.startDate,
  endDate: draft.endDate,
  priority: draft.priority,
  isActive: draft.isActive,
  createdBy: previous?.createdBy || metadata.createdBy,
  createdByName: previous?.createdByName || metadata.createdByName,
  createdAt: previous?.createdAt || metadata.createdAt,
  updatedAt: metadata.updatedAt,
});
