import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveDischargeRowViewModel } from '@/features/census/controllers/dischargeRowViewController';

describe('dischargeRowViewController', () => {
  it('builds discharge row view model with labels and actions', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'd-1',
      status: 'Fallecido',
      dischargeType: 'Domicilio (Habitual)',
    });
    const undoDischarge = vi.fn();
    const editDischarge = vi.fn();
    const deleteDischarge = vi.fn();

    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge,
      editDischarge,
      deleteDischarge,
    });

    expect(viewModel.kind).toBe('discharge');
    expect(viewModel.id).toBe('d-1');
    expect(viewModel.statusLabel).toBe('Fallecido');
    expect(viewModel.dischargeTypeLabel).toBe('Domicilio (Habitual)');
    expect(viewModel.statusBadgeClassName).toContain('bg-black');
    expect(viewModel.actions).toHaveLength(3);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();

    expect(undoDischarge).toHaveBeenCalledWith('d-1');
    expect(editDischarge).toHaveBeenCalledWith(discharge);
    expect(deleteDischarge).toHaveBeenCalledWith('d-1');
  });
});
