import type { ReminderReadReceipt } from '@/types/reminders';
import { REMINDER_PRIORITY_LABELS } from '@/shared/reminders/reminderUiOptions';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

export const formatReminderShiftLabel = (
  shift: Pick<ReminderReadReceipt, 'shift'>['shift']
): string => (shift === 'day' ? 'Dia' : 'Noche');

export const formatReminderDateRange = (startDate: string, endDate: string): string =>
  `${formatClinicalDayMonthYear(startDate)} a ${formatClinicalDayMonthYear(endDate)}`;

export const formatReminderPriorityLabel = (priority: number): string =>
  `Prioridad ${REMINDER_PRIORITY_LABELS[priority] ?? priority}`;

export const formatReminderReceiptDate = (receipt: Pick<ReminderReadReceipt, 'dateKey'>): string =>
  receipt.dateKey ? formatClinicalDayMonthYear(receipt.dateKey) : 'Legacy';
