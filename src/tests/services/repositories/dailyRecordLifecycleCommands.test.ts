// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCopyPatientToDateCommand,
  createDeleteDayCommand,
  createInitializeDayCommand,
} from '@/services/repositories/contracts/dailyRecordLifecycleCommands';

describe('dailyRecordLifecycleCommands contracts', () => {
  it('creates initializeDay command with valid dates', () => {
    const command = createInitializeDayCommand('2026-02-19', '2026-02-18');
    expect(command.date).toBe('2026-02-19');
    expect(command.copyFromDate).toBe('2026-02-18');
  });

  it('rejects initializeDay command with invalid copyFromDate', () => {
    expect(() => createInitializeDayCommand('2026-02-19', '19-02-2026')).toThrow(
      /Invalid date format/
    );
  });

  it('creates deleteDay command for valid date', () => {
    const command = createDeleteDayCommand('2026-02-19');
    expect(command.date).toBe('2026-02-19');
  });

  it('creates copyPatientToDate command for valid input', () => {
    const command = createCopyPatientToDateCommand('2026-02-18', 'R1', '2026-02-19', 'R2');
    expect(command.sourceBedId).toBe('R1');
    expect(command.targetBedId).toBe('R2');
  });

  it('rejects copyPatientToDate command with empty bed id', () => {
    expect(() => createCopyPatientToDateCommand('2026-02-18', '', '2026-02-19', 'R2')).toThrow(
      /non-empty bed id/
    );
  });
});
