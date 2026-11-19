/**
 * Backup Files Types
 * Types for the cloud backup files system
 */

/**
 * Shift types for handoff backups
 */
export type BackupShiftType = 'day' | 'night';

/**
 * Configuration for shift types
 */
export const SHIFT_TYPE_CONFIG: Record<
  BackupShiftType,
  {
    label: string;
    shortLabel: string;
  }
> = {
  day: {
    label: 'Turno Largo',
    shortLabel: 'Día',
  },
  night: {
    label: 'Turno Noche',
    shortLabel: 'Noche',
  },
};
