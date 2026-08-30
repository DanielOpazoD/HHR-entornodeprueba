import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagementActionCreators } from '@/hooks/useBedManagementActionCreators';

describe('useBedManagementActionCreators', () => {
  it('should dispatch update and toggle actions with the expected payloads', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useBedManagementActionCreators(dispatch));

    act(() => {
      result.current.updatePatient('R1', 'age', '52');
      result.current.updateClinicalCrib('R1', 'create');
      result.current.moveOrCopyPatient('copy', 'R1', 'R2');
      result.current.toggleBlockBed('R1', 'Mantencion');
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'age',
      value: '52',
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'CREATE_CLINICAL_CRIB',
      bedId: 'R1',
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: 'COPY_PATIENT',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: 'TOGGLE_BLOCK_BED',
      bedId: 'R1',
      reason: 'Mantencion',
    });
  });

  it('should route remove clinical crib and move actions correctly', () => {
    const dispatch = vi.fn();
    const dispatchAndWait = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useBedManagementActionCreators(dispatch, dispatchAndWait));
    const confirmedOccupant = { patientName: 'RN Uno', rut: '22.222.222-2' };

    act(() => {
      result.current.updateClinicalCrib(
        'R1',
        'remove',
        undefined,
        '2026-08-29T10:00:00.000Z',
        confirmedOccupant
      );
      result.current.moveOrCopyPatient('move', 'R1', 'R2');
    });

    expect(dispatchAndWait).toHaveBeenCalledWith({
      type: 'REMOVE_CLINICAL_CRIB',
      bedId: 'R1',
      confirmedLastUpdated: '2026-08-29T10:00:00.000Z',
      confirmedOccupant,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_PATIENT',
      sourceBedId: 'R1',
      targetBedId: 'R2',
    });
  });

  it('preserves clinical crib removal for callers without an async dispatcher', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useBedManagementActionCreators(dispatch));
    const confirmedOccupant = { patientName: 'RN Uno', rut: '22.222.222-2' };

    act(() => {
      result.current.updateClinicalCrib(
        'R1',
        'remove',
        undefined,
        '2026-08-29T10:00:00.000Z',
        confirmedOccupant
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'REMOVE_CLINICAL_CRIB',
      bedId: 'R1',
      confirmedLastUpdated: '2026-08-29T10:00:00.000Z',
      confirmedOccupant,
    });
  });

  it('fails closed when definitive clear has no confirmed async dispatcher', async () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useBedManagementActionCreators(dispatch));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.clearPatient('R1');
    });

    expect(accepted).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns the confirmed result from the async clear dispatcher', async () => {
    const dispatch = vi.fn();
    const dispatchAndWait = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useBedManagementActionCreators(dispatch, dispatchAndWait));

    let accepted = false;
    await act(async () => {
      accepted = await result.current.clearPatient('R1');
    });

    expect(accepted).toBe(true);
    expect(dispatchAndWait).toHaveBeenCalledWith({ type: 'CLEAR_PATIENT', bedId: 'R1' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
