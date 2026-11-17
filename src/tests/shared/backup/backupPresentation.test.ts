// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatBackupDisplayDate,
  formatBackupShiftLabel,
  getBackupShiftPresentation,
} from '@/shared/backup/backupPresentation';

describe('backupPresentation', () => {
  it('resolves shift labels from shared presentation helpers', () => {
    expect(getBackupShiftPresentation('night').label).toBe('Turno Noche');
    expect(formatBackupShiftLabel('day')).toBe('Turno Largo');
  });

  it('formats backup dates for UI surfaces', () => {
    expect(formatBackupDisplayDate('2026-03-15')).toBe('15-03-2026');
  });
});
