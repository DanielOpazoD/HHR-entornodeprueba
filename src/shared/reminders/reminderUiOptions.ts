import type { ReminderShift, ReminderType } from '@/types/reminders';
import type { UserRole } from '@/types/authRoleTypes';

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  info: 'Informativo',
  warning: 'Importante',
  urgent: 'Urgente',
};

export const REMINDER_TYPE_STYLES: Record<ReminderType, string> = {
  info: 'bg-sky-100 text-sky-800 border-sky-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  urgent: 'bg-rose-100 text-rose-800 border-rose-200',
};

export const REMINDER_PRIORITY_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Alta',
  3: 'Crítica',
};

export const REMINDER_SHIFT_OPTIONS: Array<{ value: ReminderShift; label: string }> = [
  { value: 'day', label: 'Turno Día' },
  { value: 'night', label: 'Turno Noche' },
];

export const REMINDER_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: 'Jefatura / Administrador' },
  { value: 'nurse_hospital', label: 'Enfermería Hospitalizados' },
  { value: 'doctor_urgency', label: 'Médico Urgencia' },
  { value: 'doctor_specialist', label: 'Médico Especialista' },
  { value: 'viewer', label: 'Invitado lectura general' },
  { value: 'editor', label: 'Editor legado' },
];

/** A new reminder goes to hospital nursing until the author picks other roles. */
export const DEFAULT_REMINDER_TARGET_ROLES: UserRole[] = ['nurse_hospital'];

export const getReminderRoleLabel = (role: UserRole): string =>
  REMINDER_ROLE_OPTIONS.find(option => option.value === role)?.label ?? role;
