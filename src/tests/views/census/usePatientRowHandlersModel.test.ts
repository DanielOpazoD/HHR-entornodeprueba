import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';

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

    const composedHandlers = {
      mainInputChangeHandlers: {} as any,
      cribInputChangeHandlers: {} as any,
    };
    vi.mocked(usePatientRowChangeHandlers).mockReturnValue(composedHandlers as any);

    const { result } = renderHook(() =>
      usePatientRowHandlersModel({
        bedId: 'R1',
        documentType: 'RUT',
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple: vi.fn(),
      })
    );

    expect(result.current.handlers).toBe(composedHandlers);
    expect(result.current.modalSavers.onSaveDemographics).toBe(mainSave);
    expect(result.current.modalSavers.onSaveCribDemographics).toBe(cribSave);
  });
});
