/**
 * Pure builder for the backup-handoff confirmation prompts in
 * `useExportManager`. Extracted so the prompt's exact wording (with
 * the formatted date, shift label, and "actualizar" vs "guardar"
 * variant) can be unit-tested without rendering the export controls.
 */

import { formatBackupShiftLabel } from '@/shared/backup/backupPresentation';
import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';

export interface BackupHandoffConfirmInput {
  /** ISO date `YYYY-MM-DD` of the record being archived. */
  recordDate: string;
  selectedShift: 'day' | 'night';
  isArchived: boolean;
}

export const formatBackupExportDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
};

export const buildBackupHandoffConfirmDescriptor = ({
  recordDate,
  selectedShift,
  isArchived,
}: BackupHandoffConfirmInput): ControllerConfirmDescriptor => {
  const formattedDate = formatBackupExportDate(recordDate);
  const shiftLabel = formatBackupShiftLabel(selectedShift);
  const actionLabel = isArchived ? 'Actualizar' : 'Guardar';

  return {
    title: `💾 ${actionLabel} Respaldo PDF`,
    message: isArchived
      ? `Ya existe un respaldo para ${shiftLabel} del ${formattedDate}.\n\n¿Desea sobrescribirlo con los datos actuales?`
      : `¿Desea guardar esta entrega de turno como archivo PDF?\n\nFecha: ${formattedDate}\nTurno: ${shiftLabel}`,
    confirmText: actionLabel,
    cancelText: 'Cancelar',
    variant: isArchived ? 'warning' : 'info',
  };
};
