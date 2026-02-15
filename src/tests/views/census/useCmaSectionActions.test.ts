import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useCmaSectionActions } from '@/features/census/hooks/useCmaSectionActions';

describe('useCmaSectionActions', () => {
  const confirm = vi.fn();
  const notifyError = vi.fn();
  const updateCMA = vi.fn();
  const updatePatientMultiple = vi.fn();
  const deleteCMA = vi.fn();

  const cmaItem = DataFactory.createMockCMA({
    id: 'cma-1',
    originalBedId: 'R1',
    originalData: DataFactory.createMockPatient('R1'),
  });

  const renderActions = () =>
    renderHook(() =>
      useCmaSectionActions({
        confirm,
        notifyError,
        updateCMA,
        updatePatientMultiple,
        deleteCMA,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates cma fields with partial patch', () => {
    const { result } = renderActions();

    act(() => {
      result.current.handleUpdate('cma-1', 'dischargeTime', '10:20');
    });

    expect(updateCMA).toHaveBeenCalledWith('cma-1', { dischargeTime: '10:20' });
  });

  it('undoes cma when confirmation is accepted', async () => {
    confirm.mockResolvedValueOnce(true);
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleUndo(cmaItem);
    });

    await waitFor(() => {
      expect(updatePatientMultiple).toHaveBeenCalledWith('R1', cmaItem.originalData);
      expect(deleteCMA).toHaveBeenCalledWith('cma-1');
    });
  });

  it('notifies error when confirm flow fails', async () => {
    confirm.mockRejectedValueOnce(new Error('dialog fail'));
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleUndo(cmaItem);
    });

    expect(notifyError).toHaveBeenCalledWith(
      'No se pudo deshacer',
      expect.stringContaining('No se pudo confirmar el deshacer CMA')
    );
  });

  it('deletes cma directly', () => {
    const { result } = renderActions();

    act(() => {
      result.current.handleDelete('cma-1');
    });

    expect(deleteCMA).toHaveBeenCalledWith('cma-1');
  });
});
