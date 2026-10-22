import type { BackupFileType, BackupShiftType } from '@/types/backup';
import { BACKUP_TYPE_CONFIG, SHIFT_TYPE_CONFIG } from '@/types/backup';
import { formatCensusIsoDate } from '@/shared/census/censusPresentation';
import { formatCalendarDate, formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

export const getBackupTypePresentation = (type: BackupFileType) => BACKUP_TYPE_CONFIG[type];

export const getBackupShiftPresentation = (shiftType: BackupShiftType) =>
  SHIFT_TYPE_CONFIG[shiftType];

export const formatBackupShiftLabel = (shiftType: BackupShiftType): string =>
  getBackupShiftPresentation(shiftType).label;

export const formatBackupTimestamp = (isoStr: string): string => {
  const date = new Date(isoStr);
  return date.toLocaleString('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatBackupDisplayDate = (dateStr: string): string => {
  return formatCensusIsoDate(dateStr);
};

export const formatBackupCompactDate = (dateStr: string): string => formatDateDDMMYYYY(dateStr);

export const formatBackupDisplayDateVerbose = (dateStr: string): string =>
  formatCalendarDate(dateStr, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }) ?? dateStr;

export const formatBackupClockTime = (isoStr: string): string => {
  const date = new Date(isoStr);
  return date.toLocaleTimeString('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
};
