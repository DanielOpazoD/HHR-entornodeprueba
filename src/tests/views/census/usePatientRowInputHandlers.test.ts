import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import { harmonizeEpisodeDemographicsHistorySafely } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/controllers/patientDemographicsEpisodeSyncController', () => ({
  harmonizeEpisodeDemographicsHistorySafely: vi.fn(),
}));

describe('usePatientRowInputHandlers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps main row handlers to daily record actions', () => {
    vi.useFakeTimers();
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();
    const data = DataFactory.createMockPatient('R1', {
      firstSeenDate: '2026-01-01',
    });

    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data,
        documentType: 'RUT',
        updatePatient,
        updatePatientMultiple,
      })
    );

    act(() => {
      result.current.handleTextChange('patientName')({
        target: { value: 'Paciente X' },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleCheckboxChange('isUPC')({
        target: { checked: true },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleTextChange('status')({
        target: { value: 'De cuidado' },
      } as ChangeEvent<HTMLSelectElement>);
      result.current.toggleDocumentType();
      result.current.handleDemographicsSave({ age: '40' });
      result.current.handleDeliveryRouteChange('Vaginal', '2026-02-12', undefined);
    });

    expect(updatePatient).toHaveBeenCalledWith('R1', 'patientName', 'Paciente X');
    expect(updatePatient).toHaveBeenCalledWith('R1', 'isUPC', true);
    expect(updatePatient).toHaveBeenCalledWith('R1', 'status', 'De cuidado');
    expect(updatePatient).toHaveBeenCalledWith('R1', 'documentType', 'Pasaporte');
    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', { age: '40' });
    expect(harmonizeEpisodeDemographicsHistorySafely).toHaveBeenCalledWith({
      currentDate: '2026-01-03',
      sourcePatient: data,
      updatedFields: { age: '40' },
    });
    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', {
      deliveryRoute: 'Vaginal',
      deliveryDate: '2026-02-12',
      deliveryCesareanLabor: undefined,
    });

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(updatePatientMultiple).not.toHaveBeenCalledWith('R1', { status: 'De cuidado' });
  });

  it('coalesces rapid initial clinical fields into one daily record patch', () => {
    vi.useFakeTimers();
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();

    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        documentType: 'RUT',
        updatePatient,
        updatePatientMultiple,
      })
    );

    act(() => {
      result.current.handleTextChange('pathology')({
        target: { value: 'Neumonia' },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleTextChange('specialty')({
        target: { value: 'Med Interna' },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleTextChange('status')({
        target: { value: 'Estable' },
      } as ChangeEvent<HTMLSelectElement>);
    });

    expect(updatePatient).not.toHaveBeenCalledWith('R1', 'pathology', 'Neumonia');
    expect(updatePatient).not.toHaveBeenCalledWith('R1', 'specialty', 'Med Interna');
    expect(updatePatient).toHaveBeenCalledWith('R1', 'status', 'Estable');
    expect(updatePatientMultiple).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(updatePatientMultiple).toHaveBeenCalledTimes(1);
    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', {
      pathology: 'Neumonia',
      specialty: 'Med Interna',
    });
  });

  it('keeps non clinical fields immediate while deferring clinical fields from mixed patches', () => {
    vi.useFakeTimers();
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();

    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        documentType: 'RUT',
        updatePatient,
        updatePatientMultiple,
      })
    );

    act(() => {
      result.current.handleDemographicsSave({
        patientName: 'Paciente X',
        specialty: 'Pediatria',
        secondarySpecialty: undefined,
      });
    });

    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', {
      patientName: 'Paciente X',
    });
    expect(updatePatientMultiple).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(updatePatientMultiple).toHaveBeenCalledTimes(2);
    expect(updatePatientMultiple).toHaveBeenLastCalledWith('R1', {
      specialty: 'Pediatria',
      secondarySpecialty: undefined,
    });
  });

  it('flushes pending initial clinical fields when the row unmounts', () => {
    vi.useFakeTimers();
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();

    const { result, unmount } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        documentType: 'RUT',
        updatePatient,
        updatePatientMultiple,
      })
    );

    act(() => {
      result.current.handleTextChange('pathology')({
        target: { value: 'Neumonia' },
      } as ChangeEvent<HTMLInputElement>);
    });

    expect(updatePatientMultiple).not.toHaveBeenCalled();

    unmount();

    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', {
      pathology: 'Neumonia',
    });
  });

  it('maps clinical crib handlers to clinical crib actions', () => {
    const updateClinicalCrib = vi.fn();
    const updateClinicalCribMultiple = vi.fn();
    const cribData = DataFactory.createMockPatient('C1', {
      patientName: 'RN X',
      firstSeenDate: '2026-01-01',
    });

    const { result } = renderHook(() =>
      usePatientRowCribInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: cribData,
        updateClinicalCrib,
        updateClinicalCribMultiple,
      })
    );

    act(() => {
      result.current.handleCribTextChange('patientName')({
        target: { value: 'RN X' },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleCribCheckboxChange('isUPC')({
        target: { checked: true },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleCribDevicesChange(['VVP#1']);
      result.current.handleCribDemographicsSave({ age: '2d' });
    });

    expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'patientName', 'RN X');
    expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'isUPC', true);
    expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'devices', ['VVP#1']);
    expect(updateClinicalCribMultiple).toHaveBeenCalledWith('R1', { age: '2d' });
    expect(harmonizeEpisodeDemographicsHistorySafely).toHaveBeenCalledWith({
      currentDate: '2026-01-03',
      sourcePatient: cribData,
      updatedFields: { age: '2d' },
      isClinicalCribPatient: true,
    });
  });

  it('defaults document type toggle to Pasaporte when current type is undefined', () => {
    const updatePatient = vi.fn();
    const updatePatientMultiple = vi.fn();

    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R5',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R5'),
        documentType: undefined,
        updatePatient,
        updatePatientMultiple,
      })
    );

    act(() => {
      result.current.toggleDocumentType();
      result.current.handleDeliveryRouteChange(undefined, undefined, undefined);
    });

    expect(updatePatient).toHaveBeenCalledWith('R5', 'documentType', 'Pasaporte');
    expect(updatePatientMultiple).toHaveBeenCalledWith('R5', {
      deliveryRoute: undefined,
      deliveryDate: undefined,
      deliveryCesareanLabor: undefined,
    });
  });
});
