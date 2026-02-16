import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveTransferRowViewModel } from '@/features/census/controllers/transferRowViewController';

describe('transferRowViewController', () => {
  it('builds transfer row view model with center/escort labels and actions', () => {
    const transfer = DataFactory.createMockTransfer({
      id: 't-1',
      evacuationMethod: 'Ambulancia',
      receivingCenter: 'Otro',
      receivingCenterOther: 'Clinica X',
      transferEscort: 'Enfermera Y',
    });
    const undoTransfer = vi.fn();
    const editTransfer = vi.fn();
    const deleteTransfer = vi.fn();

    const viewModel = resolveTransferRowViewModel(transfer, {
      undoTransfer,
      editTransfer,
      deleteTransfer,
    });

    expect(viewModel.kind).toBe('transfer');
    expect(viewModel.id).toBe('t-1');
    expect(viewModel.receivingCenterLabel).toBe('Clinica X');
    expect(viewModel.transferEscortLabel).toContain('Enfermera Y');
    expect(viewModel.actions).toHaveLength(3);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();

    expect(undoTransfer).toHaveBeenCalledWith('t-1');
    expect(editTransfer).toHaveBeenCalledWith(transfer);
    expect(deleteTransfer).toHaveBeenCalledWith('t-1');
  });
});
