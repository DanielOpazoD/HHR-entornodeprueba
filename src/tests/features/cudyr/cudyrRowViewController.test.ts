import { describe, expect, it } from 'vitest';

import { buildCudyrRowViewModel } from '@/features/cudyr/controllers/cudyrRowViewController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('cudyrRowViewController', () => {
  it('builds a blocked row state without visible scores', () => {
    const bed = { id: 'R1', name: 'R1', type: 'UTI', isCuna: false } as const as never;
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE BLOQUEADO',
      cudyr: DataFactory.createMockCudyr({ changeClothes: 3, vitalSigns: 3 }),
    });

    const viewModel = buildCudyrRowViewModel({
      bed,
      patient,
      eligibilityBlocked: true,
      eligibilityBlockedReason: 'Ingreso menor a 8 h al corte fijo 01:00.',
    });

    expect(viewModel.showBlockedLabel).toBe(true);
    expect(viewModel.displayedDepScore).toBe('');
    expect(viewModel.displayedRiskScore).toBe('');
    expect(viewModel.scores).toBeUndefined();
    expect(viewModel.patientCellClass).toContain('text-amber-700');
    expect(viewModel.rowReadOnly).toBe(true);
  });

  it('builds an empty crib row state with the correct label and colors', () => {
    const bed = { id: 'R1-crib', name: 'R1 (CC)', type: 'UTI', isCuna: true } as const as never;

    const viewModel = buildCudyrRowViewModel({
      bed,
      patient: undefined,
      isCrib: true,
    });

    expect(viewModel.isOccupied).toBe(false);
    expect(viewModel.emptyStateLabel).toBe('Cuna RN sin paciente');
    expect(viewModel.rowBgClass).toContain('bg-purple-50/60');
    expect(viewModel.bedTextClass).toContain('text-purple-700');
  });

  it('builds a categorized row state when the patient has CUDYR scores', () => {
    const bed = { id: 'R2', name: 'R2', type: 'BASICA', isCuna: false } as const as never;
    const patient = DataFactory.createMockPatient('R2', {
      patientName: 'PACIENTE',
      cudyr: DataFactory.createMockCudyr({
        changeClothes: 2,
        mobilization: 2,
        feeding: 2,
        elimination: 1,
        vitalSigns: 2,
        fluidBalance: 2,
        oxygenTherapy: 2,
        airway: 2,
        proInterventions: 2,
        skinCare: 2,
      }),
    });

    const viewModel = buildCudyrRowViewModel({
      bed,
      patient,
    });

    expect(viewModel.isOccupied).toBe(true);
    expect(viewModel.rowReadOnly).toBe(false);
    expect(viewModel.finalCat).toBe('B2');
    expect(viewModel.displayedDepScore).toBe(7);
    expect(viewModel.displayedRiskScore).toBe(12);
    expect(viewModel.scores).toBeDefined();
  });

  it('treats whitespace-only patient names as an empty CUDYR row', () => {
    const bed = { id: 'R4', name: 'R4', type: 'BASICA', isCuna: false } as const as never;
    const patient = DataFactory.createMockPatient('R4', {
      patientName: '   ',
      cudyr: DataFactory.createMockCudyr({ changeClothes: 3, vitalSigns: 3 }),
    });

    const viewModel = buildCudyrRowViewModel({
      bed,
      patient,
    });

    expect(viewModel.isOccupied).toBe(false);
    expect(viewModel.scores).toBeDefined();
    expect(viewModel.emptyStateLabel).toBe('Cama disponible');
  });
});
