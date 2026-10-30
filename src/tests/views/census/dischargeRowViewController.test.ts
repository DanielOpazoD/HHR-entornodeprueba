// @vitest-environment node
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
    const openHospitalizationReports = vi.fn();
    const editDischarge = vi.fn();
    const deleteDischarge = vi.fn();
    const convertDischargeToCma = vi.fn();

    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge,
      viewClinicalDocuments,
      openHospitalizationReports,
      editDischarge,
      deleteDischarge,
      convertDischargeToCma,
    });

    expect(viewModel.kind).toBe('discharge');
    expect(viewModel.id).toBe('d-1');
    expect(viewModel.statusLabel).toBe('Vivo');
    expect(viewModel.dischargeTypeLabel).toBe('Domicilio (Habitual)');
    expect(viewModel.statusBadgeClassName).toContain('bg-green');
    expect(viewModel.actions).toHaveLength(6);

    viewModel.actions[0]?.onClick();
    viewModel.actions[1]?.onClick();
    viewModel.actions[2]?.onClick();
    viewModel.actions[3]?.onClick();
    viewModel.actions[4]?.onClick();
    viewModel.actions[5]?.onClick();

    expect(undoDischarge).toHaveBeenCalledWith('d-1');
    expect(editDischarge).toHaveBeenCalledWith(discharge);
    expect(deleteDischarge).toHaveBeenCalledWith('d-1');
    expect(viewClinicalDocuments).toHaveBeenCalledWith(discharge);
    expect(openHospitalizationReports).toHaveBeenCalledWith(discharge);
    expect(convertDischargeToCma).toHaveBeenCalledWith('d-1');
  });

  it('labels a Cuna RN departure as associated and normalizes its historical bed label', () => {
    const discharge = DataFactory.createMockDischarge({
      isNested: true,
      bedName: 'H4C1 (Cuna clínica)',
    });
    const noop = vi.fn();
    const viewModel = resolveDischargeRowViewModel(discharge, {
      undoDischarge: noop,
      viewClinicalDocuments: noop,
      openHospitalizationReports: noop,
      editDischarge: noop,
      deleteDischarge: noop,
      convertDischargeToCma: noop,
    });

    expect(viewModel.isAssociatedClinicalCrib).toBe(true);
    expect(viewModel.bedName).toBe('C-H4C1');
    expect(viewModel.dischargeTypeLabel).toBe('Alta asociada');
  });

  it.each(['R3', 'C-R3'])('keeps a standalone crib distinct after discharge: %s', bedName => {
    const discharge = DataFactory.createMockDischarge({
      bedId: 'R3',
      bedName,
      isNested: false,
      originalData: DataFactory.createMockPatient('R3', { bedMode: 'Cuna' }),
    });
    const noop = vi.fn();
    const handlers = {
      undoDischarge: noop,
      viewClinicalDocuments: noop,
      openHospitalizationReports: noop,
      editDischarge: noop,
      deleteDischarge: noop,
      convertDischargeToCma: noop,
    };
    const viewModel = resolveDischargeRowViewModel(discharge, handlers);
    expect(viewModel.bedName).toBe('C-R3');
    expect(viewModel.dischargeTypeLabel).toBe('Alta en cuna');
    viewModel.actions[0].onClick();
    expect(noop).toHaveBeenCalledWith(discharge.id);
    expect(discharge.isNested).toBe(false);
    expect(
      resolveDischargeRowViewModel(
        {
          ...discharge,
          bedName: 'R3',
          bedType: 'Media',
          originalData: { ...discharge.originalData!, bedMode: 'Cama' },
        },
        handlers
      ).bedName
    ).toBe('R3');
  });
});
