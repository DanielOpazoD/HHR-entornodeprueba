import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';
import type { BuildPatientRowChangeHandlersResult } from '@/features/census/controllers/patientRowChangeHandlersController';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/patient-row/usePatientRowInputHandlers', () => ({
  usePatientRowMainInputHandlers: vi.fn(),
  usePatientRowCribInputHandlers: vi.fn(),
}));

vi.mock('@/features/census/components/patient-row/usePatientRowChangeHandlers', () => ({
  usePatientRowChangeHandlers: vi.fn(),
}));

describe('usePatientRowHandlersModel', () => {
  it('composes runtime handlers and modal savers from main/crib hooks', () => {
    const mainSave = vi.fn();
    const cribSave = vi.fn();
    const clearPatient = vi.fn();

    vi.mocked(usePatientRowMainInputHandlers).mockReturnValue({
      handleTextChange: vi.fn(),
      handleCheckboxChange: vi.fn(),
      handleDevicesChange: vi.fn(),
      handleDeviceDetailsChange: vi.fn(),
      handleDeviceHistoryChange: vi.fn(),
      handleDemographicsSave: mainSave,
      toggleDocumentType: vi.fn(),
      handleDeliveryRouteChange: vi.fn(),
    });

    vi.mocked(usePatientRowCribInputHandlers).mockReturnValue({
      handleCribTextChange: vi.fn(),
      handleCribCheckboxChange: vi.fn(),
      handleCribDevicesChange: vi.fn(),
      handleCribDeviceDetailsChange: vi.fn(),
      handleCribDeviceHistoryChange: vi.fn(),
      handleCribDemographicsSave: cribSave,
    });

    const composedHandlers: BuildPatientRowChangeHandlersResult = {
      mainInputChangeHandlers: {} as BuildPatientRowChangeHandlersResult['mainInputChangeHandlers'],
      cribInputChangeHandlers: {} as BuildPatientRowChangeHandlersResult['cribInputChangeHandlers'],
    };
    vi.mocked(usePatientRowChangeHandlers).mockReturnValue(composedHandlers);

    const { result } = renderHook(() =>
      usePatientRowHandlersModel({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        cribData: undefined,
        documentType: 'RUT',
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        clearPatient,
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple: vi.fn(),
      })
    );

    expect(result.current.handlers).toBe(composedHandlers);
    expect(result.current.modalSavers.onSaveDemographics).toBe(mainSave);
    expect(result.current.modalSavers.onSaveCribDemographics).toBe(cribSave);
    result.current.modalSavers.onRevertEmptyDemographics();
    expect(clearPatient).toHaveBeenCalledWith('R1');
  });
});
