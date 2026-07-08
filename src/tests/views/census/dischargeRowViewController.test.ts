import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveDischargeRowViewModel } from '@/features/census/controllers/dischargeRowViewController';

describe('dischargeRowViewController', () => {
  it('builds discharge row view model with labels and actions', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'd-1',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    });
    const undoDischarge = vi.fn();
    const viewClinicalDocuments = vi.fn();
    const editDischarge = vi.fn();
    const deleteDischarge = vi.fn();
    const convertDischargeToCma = vi.fn();

    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge,
      viewClinicalDocuments,
      editDischarge,
      deleteDischarge,
      convertDischargeToCma,
    });

    expect(viewModel.kind).toBe('discharge');
    expect(viewModel.id).toBe('d-1');
    expect(viewModel.statusLabel).toBe('Vivo');
    expect(viewModel.dischargeTypeLabel).toBe('Domicilio (Habitual)');
    expect(viewModel.statusBadgeClassName).toContain('bg-green');
    expect(viewModel.actions).toHaveLength(5);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();
    viewModel.actions[3]?.onClick();
    viewModel.actions[4]?.onClick();

    expect(undoDischarge).toHaveBeenCalledWith('d-1');
    expect(editDischarge).toHaveBeenCalledWith(discharge);
    expect(deleteDischarge).toHaveBeenCalledWith('d-1');
    expect(viewClinicalDocuments).toHaveBeenCalledWith(discharge);
    expect(convertDischargeToCma).toHaveBeenCalledWith('d-1');
  });
});
