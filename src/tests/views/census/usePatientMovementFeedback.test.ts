import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePatientMovementFeedback } from '@/features/census/hooks/usePatientMovementFeedback';

describe('usePatientMovementFeedback', () => {
  it('routes creation warnings to runtime.warn when available', () => {
    const runtime = { alert: vi.fn(), warn: vi.fn() };
    const { result } = renderHook(() => usePatientMovementFeedback(runtime));

    result.current.notifyCreationError('discharge', 'SOURCE_BED_EMPTY', 'R1');

    expect(runtime.warn).toHaveBeenCalledWith('Attempted to discharge empty bed: R1');
    expect(runtime.alert).not.toHaveBeenCalled();
  });

  it('falls back to console.warn when runtime.warn is missing', () => {
    const runtime = { alert: vi.fn() };
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => usePatientMovementFeedback(runtime));

    result.current.notifyCreationError('transfer', 'BED_NOT_FOUND', 'R2');

    expect(consoleSpy).toHaveBeenCalledWith('Attempted to transfer unknown bed: R2');
    consoleSpy.mockRestore();
  });

  it('routes undo errors to runtime.alert', () => {
    const runtime = { alert: vi.fn(), warn: vi.fn() };
    const { result } = renderHook(() => usePatientMovementFeedback(runtime));

    result.current.notifyUndoError('transfer', 'MAIN_BED_OCCUPIED', {
      patientName: 'Paciente X',
      bedName: 'R1',
    });

    expect(runtime.alert).toHaveBeenCalledWith(
      'No se puede deshacer el traslado de Paciente X porque la cama R1 ya está ocupada.'
    );
  });
});
