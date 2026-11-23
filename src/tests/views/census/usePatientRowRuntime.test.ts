import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientRowRuntime } from '@/features/census/components/patient-row/usePatientRowRuntime';
import { usePatientRowUiState } from '@/features/census/components/patient-row/usePatientRowUiState';
import { usePatientRowBedConfigActions } from '@/features/census/components/patient-row/usePatientRowBedConfigActions';
import { usePatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';
import { usePatientRowHandlersModel } from '@/features/census/components/patient-row/usePatientRowHandlersModel';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';
import type { BuildPatientRowChangeHandlersResult } from '@/features/census/controllers/patientRowChangeHandlersController';

vi.mock('@/features/census/components/patient-row/usePatientRowDependencies', () => ({
  usePatientRowDependencies: vi.fn(),
}));

vi.mock('@/features/census/components/patient-row/usePatientRowUiState', () => ({
  usePatientRowUiState: vi.fn(),
}));

vi.mock('@/features/census/components/patient-row/usePatientRowBedConfigActions', () => ({
  usePatientRowBedConfigActions: vi.fn(),
}));

vi.mock('@/features/census/components/patient-row/usePatientRowHandlersModel', () => ({
  usePatientRowHandlersModel: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;
const createMockChangeHandlers = (): BuildPatientRowChangeHandlersResult => ({
  mainInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    toggleDocType: vi.fn(),
    deliveryRoute: vi.fn(),
    multiple: vi.fn(),
  },
  cribInputChangeHandlers: {
    text: vi.fn(() => vi.fn()),
    check: vi.fn(() => vi.fn()),
    devices: vi.fn(),
    deviceDetails: vi.fn(),
    deviceHistory: vi.fn(),
    multiple: vi.fn(),
  },
});

describe('usePatientRowRuntime', () => {
  const toggleBedType = vi.fn();
  const updateClinicalCrib = vi.fn();
  const onAction = vi.fn();
  const bed = { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false };
  const data = DataFactory.createMockPatient('R1');

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(usePatientRowDependencies).mockReturnValue(
      asHookValue<ReturnType<typeof usePatientRowDependencies>>({
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        clearPatient: vi.fn(),
        updateClinicalCrib,
        updateClinicalCribMultiple: vi.fn(),
        toggleBedType,
        confirm: vi.fn(),
        alert: vi.fn(),
      })
    );
    vi.mocked(usePatientRowUiState).mockReturnValue(
      asHookValue<ReturnType<typeof usePatientRowUiState>>({
        showDemographics: false,
        showExamRequest: false,
        showHistory: false,
        openDemographics: vi.fn(),
        closeDemographics: vi.fn(),
        openExamRequest: vi.fn(),
        closeExamRequest: vi.fn(),
        openHistory: vi.fn(),
        closeHistory: vi.fn(),
      })
    );
    vi.mocked(usePatientRowHandlersModel).mockReturnValue(
      asHookValue<ReturnType<typeof usePatientRowHandlersModel>>({
        handlers: {
          ...createMockChangeHandlers(),
        },
        modalSavers: {
          onSaveDemographics: vi.fn(),
          onSaveCribDemographics: vi.fn(),
          onRevertEmptyDemographics: vi.fn(),
        },
      })
    );
    vi.mocked(usePatientRowBedConfigActions).mockReturnValue(
      asHookValue<ReturnType<typeof usePatientRowBedConfigActions>>({
        toggleBedMode: vi.fn(),
        toggleCompanionCrib: vi.fn(),
        toggleClinicalCrib: vi.fn(),
      })
    );
  });

  it('delegates row action with bed id and patient data', () => {
    const { result } = renderHook(() =>
      usePatientRowRuntime({ bed, data, currentDateString: '2026-01-03', onAction })
    );

    act(() => {
      result.current.handleAction('move');
    });

    expect(onAction).toHaveBeenCalledWith('move', 'R1', data);
  });

  it('wires bed type and clinical crib update handlers', () => {
    const { result } = renderHook(() =>
      usePatientRowRuntime({ bed, data, currentDateString: '2026-01-03', onAction })
    );

    act(() => {
      result.current.bedTypeToggles.onToggleBedType();
      result.current.bedTypeToggles.onUpdateClinicalCrib('remove');
    });

    expect(toggleBedType).toHaveBeenCalledWith('R1');
    expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'remove');
  });

  it('passes the row editing contract straight to the handlers model', () => {
    renderHook(() =>
      usePatientRowRuntime({ bed, data, currentDateString: '2026-01-03', onAction })
    );

    const dependencies = vi.mocked(usePatientRowDependencies).mock.results[0].value;
    expect(usePatientRowHandlersModel).toHaveBeenCalledWith({
      bedId: 'R1',
      currentDateString: '2026-01-03',
      data,
      documentType: data.documentType,
      updatePatient: dependencies.updatePatient,
      updatePatientMultiple: dependencies.updatePatientMultiple,
      clearPatient: dependencies.clearPatient,
      updateClinicalCrib: dependencies.updateClinicalCrib,
      updateClinicalCribMultiple: dependencies.updateClinicalCribMultiple,
    });
  });

  it('keeps runtime object identity stable across rerenders when inputs are unchanged', () => {
    const { result, rerender } = renderHook(() =>
      usePatientRowRuntime({ bed, data, currentDateString: '2026-01-03', onAction })
    );

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.rowState).toBe(first.rowState);
  });
});
