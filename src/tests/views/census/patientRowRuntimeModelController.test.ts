import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowEditingRuntimeParams,
  buildPatientRowRuntimeHookParams,
  buildPatientRowInteractionRuntimeParams,
} from '@/features/census/controllers/patientRowRuntimeModelController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientRowRuntimeModelController', () => {
  it('builds editing runtime params from row dependencies', () => {
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();
    const clearPatient = vi.fn();
    const updateClinicalCrib = vi.fn();
    const updateClinicalCribMultiple = vi.fn();

    const result = buildPatientRowEditingRuntimeParams({
      bed: { id: 'R1' },
      data: DataFactory.createMockPatient('R1', { documentType: 'RUT' }),
      currentDateString: '2026-01-03',
      dependencies: {
        updatePatient,
        updatePatientMultiple,
        clearPatient,
        updateClinicalCrib,
        updateClinicalCribMultiple,
      },
    });

    expect(result).toEqual({
      bedId: 'R1',
      currentDateString: '2026-01-03',
      data: expect.objectContaining({ documentType: 'RUT' }),
      documentType: 'RUT',
      updatePatient,
      updatePatientMultiple,
      clearPatient,
      updateClinicalCrib,
      updateClinicalCribMultiple,
    });
  });

  it('builds interaction runtime params from row state and callbacks', () => {
    const patient = DataFactory.createMockPatient('R1');
    const onAction = vi.fn();
    const updatePatient = vi.fn();
    const updateClinicalCrib = vi.fn();
    const toggleBedType = vi.fn();
    const confirm = vi.fn();
    const alert = vi.fn();

    const result = buildPatientRowInteractionRuntimeParams({
      bed: { id: 'R1' },
      data: patient,
      onAction,
      rowState: {
        isCunaMode: false,
        hasCompanion: false,
        hasClinicalCrib: false,
      },
      dependencies: {
        updatePatient,
        updateClinicalCrib,
        toggleBedType,
        confirm,
        alert,
      },
    });

    expect(result.bedId).toBe('R1');
    expect(result.data).toBe(patient);
    expect(result.onAction).toBe(onAction);
    expect(result.updatePatient).toBe(updatePatient);
    expect(result.updateClinicalCrib).toBe(updateClinicalCrib);
    expect(result.toggleBedType).toBe(toggleBedType);
    expect(result.confirm).toBe(confirm);
    expect(result.alert).toBe(alert);
  });

  it('builds the composite runtime hook params from one dependency bundle', () => {
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();
    const clearPatient = vi.fn();
    const updateClinicalCrib = vi.fn();
    const updateClinicalCribMultiple = vi.fn();
    const toggleBedType = vi.fn();
    const confirm = vi.fn();
    const alert = vi.fn();
    const patient = DataFactory.createMockPatient('R1', { documentType: 'RUT' });
    const onAction = vi.fn();

    const result = buildPatientRowRuntimeHookParams({
      bed: { id: 'R1' },
      data: patient,
      currentDateString: '2026-01-03',
      onAction,
      rowState: {
        isCunaMode: false,
        hasCompanion: true,
        hasClinicalCrib: false,
      },
      dependencies: {
        updatePatient,
        updatePatientMultiple,
        clearPatient,
        updateClinicalCrib,
        updateClinicalCribMultiple,
        toggleBedType,
        confirm,
        alert,
      },
    });

    expect(result.editingRuntimeParams).toEqual({
      bedId: 'R1',
      currentDateString: '2026-01-03',
      data: patient,
      documentType: 'RUT',
      updatePatient,
      updatePatientMultiple,
      clearPatient,
      updateClinicalCrib,
      updateClinicalCribMultiple,
    });
    expect(result.interactionRuntimeParams).toEqual({
      bedId: 'R1',
      data: patient,
      recordLastUpdated: undefined,
      isSubRow: false,
      onAction,
      rowState: {
        isCunaMode: false,
        hasCompanion: true,
        hasClinicalCrib: false,
      },
      updatePatient,
      updateClinicalCrib,
      toggleBedType,
      confirm,
      alert,
    });
  });
});
