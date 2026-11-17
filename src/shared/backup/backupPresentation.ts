import type { BackupShiftType } from '@/types/backup';
import { SHIFT_TYPE_CONFIG } from '@/types/backup';
import { formatCensusIsoDate } from '@/shared/census/censusPresentation';

export const getBackupShiftPresentation = (shiftType: BackupShiftType) =>
  SHIFT_TYPE_CONFIG[shiftType];

export const formatBackupShiftLabel = (shiftType: BackupShiftType): string =>
  getBackupShiftPresentation(shiftType).label;

export const formatBackupDisplayDate = (dateStr: string): string => {
  return formatCensusIsoDate(dateStr);
};
