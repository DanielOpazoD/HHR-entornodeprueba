import { describe, expect, it } from 'vitest';
import { getMovementCreationWarningMessage } from '@/features/census/controllers/patientMovementCreationErrorPresentation';

describe('patientMovementCreationErrorPresentation', () => {
  it('formats discharge warnings', () => {
    expect(getMovementCreationWarningMessage('discharge', 'SOURCE_BED_EMPTY', 'R1')).toBe(
      'Attempted to discharge empty bed: R1'
    );
    expect(getMovementCreationWarningMessage('discharge', 'BED_NOT_FOUND', 'R2')).toBe(
      'Attempted to discharge unknown bed: R2'
    );
  });

  it('formats transfer warnings', () => {
    expect(getMovementCreationWarningMessage('transfer', 'SOURCE_BED_EMPTY', 'R1')).toBe(
      'Attempted to transfer empty bed: R1'
    );
    expect(getMovementCreationWarningMessage('transfer', 'BED_NOT_FOUND', 'R2')).toBe(
      'Attempted to transfer unknown bed: R2'
    );
  });
});
