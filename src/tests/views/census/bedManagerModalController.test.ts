import { describe, expect, it } from 'vitest';
import {
  closeBedManagerBlockingDialog,
  closeBedManagerEditingDialog,
  hasBedManagerDialogOpen,
  INITIAL_BED_MANAGER_MODAL_STATE,
  patchBedManagerError,
  patchBedManagerReason,
  resolveBedManagerBedClick,
  validateBedManagerReason,
} from '@/features/census/controllers/bedManagerModalController';

describe('bedManagerModalController', () => {
  it('opens edit mode when clicking a blocked bed', () => {
    const nextState = resolveBedManagerBedClick(INITIAL_BED_MANAGER_MODAL_STATE, {
      bedId: 'R1',
      isBlocked: true,
      blockedReason: 'Mantención',
    });

    expect(nextState).toEqual({
      blockingBedId: null,
      editingBedId: 'R1',
      reason: 'Mantención',
      error: null,
    });
  });

  it('opens block mode when clicking an available bed', () => {
    const nextState = resolveBedManagerBedClick(
      {
        blockingBedId: null,
        editingBedId: 'R1',
        reason: 'Previo',
        error: 'error',
      },
      {
        bedId: 'R2',
        isBlocked: false,
      }
    );

    expect(nextState).toEqual({
      blockingBedId: 'R2',
      editingBedId: null,
      reason: '',
      error: null,
    });
  });

  it('validates reason and returns explicit error for invalid input', () => {
    const invalid = validateBedManagerReason('');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('INVALID_REASON');
    }

    const valid = validateBedManagerReason('Aislamiento');
    expect(valid).toEqual({ ok: true, value: 'Aislamiento' });
  });

  it('patches reason/error and closes dialogs consistently', () => {
    const withReason = patchBedManagerReason(INITIAL_BED_MANAGER_MODAL_STATE, 'Motivo');
    expect(withReason.reason).toBe('Motivo');
    expect(withReason.error).toBeNull();

    const withError = patchBedManagerError(withReason, 'Error');
    expect(withError.error).toBe('Error');

    const blockOpen = { ...withError, blockingBedId: 'R3' };
    expect(hasBedManagerDialogOpen(blockOpen)).toBe(true);
    expect(closeBedManagerBlockingDialog(blockOpen)).toEqual({
      blockingBedId: null,
      editingBedId: null,
      reason: '',
      error: null,
    });

    const editOpen = { ...withError, editingBedId: 'R4' };
    expect(hasBedManagerDialogOpen(editOpen)).toBe(true);
    expect(closeBedManagerEditingDialog(editOpen)).toEqual({
      blockingBedId: null,
      editingBedId: null,
      reason: '',
      error: null,
    });
  });
});
