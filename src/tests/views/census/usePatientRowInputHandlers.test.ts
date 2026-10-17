import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ChangeEvent } from 'react';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import { harmonizeEpisodeDemographicsHistorySafely } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { featureFlags } from '@/services/utils/featureFlags';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/controllers/patientDemographicsEpisodeSyncController', () => ({
  harmonizeEpisodeDemographicsHistorySafely: vi.fn(),
}));

describe('usePatientRowInputHandlers', () => {
  afterEach(() => {
    vi.useRealTimers();
    featureFlags.reset('SPECIALTY_EPISODE_ASSIGNMENT');
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

  it('keeps rapid diagnosis typing separate from the immediate specialty decision', () => {
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
    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', { specialty: 'Med Interna' });

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(updatePatientMultiple).toHaveBeenCalledTimes(2);
    expect(updatePatientMultiple).toHaveBeenLastCalledWith('R1', { pathology: 'Neumonia' });
  });

  it('awaits the specialty decision before submitting the rest of an explicit form', async () => {
    let confirm!: (value: boolean) => void;
    const updatePatientMultiple = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>(resolve => {
            confirm = resolve;
          })
      )
      .mockResolvedValue(true);
    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        updatePatient: vi.fn(),
        updatePatientMultiple,
      })
    );
    let saved!: ReturnType<typeof result.current.handleDemographicsSave>;
    act(() => {
      saved = result.current.handleDemographicsSave({
        specialty: 'Pediatría',
        pathology: 'Diagnóstico sintético',
      });
    });
    expect(updatePatientMultiple).toHaveBeenCalledTimes(1);
    expect(updatePatientMultiple).toHaveBeenCalledWith('R1', { specialty: 'Pediatría' });
    await act(async () => {
      confirm(true);
      expect(await saved).toBe(true);
    });
    expect(updatePatientMultiple).toHaveBeenLastCalledWith('R1', {
      pathology: 'Diagnóstico sintético',
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
  it('preserves the atomic replacement guard instead of saving the old occupant specialty', async () => {
    const updatePatientMultiple = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        updatePatient: vi.fn(),
        updatePatientMultiple,
      })
    );
    const patch = {
      patientName: 'Reemplazo sintético',
      rut: '22.222.222-2',
      specialty: 'Pediatría' as const,
    };
    expect(await result.current.handleDemographicsSave(patch)).toBe(false);
    expect(updatePatientMultiple).toHaveBeenCalledExactlyOnceWith('R1', patch);
  });

  it('does not flush an older inline diagnosis after an explicit clinical submission', async () => {
    vi.useFakeTimers();
    const updatePatientMultiple = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      usePatientRowMainInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('R1'),
        updatePatient: vi.fn(),
        updatePatientMultiple,
      })
    );
    act(() =>
      result.current.handleTextChange('pathology')({
        target: { value: 'Draft antiguo' },
      } as ChangeEvent<HTMLInputElement>)
    );
    await act(async () => {
      expect(
        await result.current.handleDemographicsSave({
          specialty: 'Med Interna',
          pathology: 'Diagnóstico final',
        })
      ).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(updatePatientMultiple.mock.calls).toEqual([
      ['R1', { specialty: 'Med Interna' }],
      ['R1', { pathology: 'Diagnóstico final' }],
    ]);
  });

  it.each([false, true])(
    'keeps rejected specialty saves separate from diagnosis (pilot %s)',
    async enabled => {
      if (enabled) featureFlags.enable('SPECIALTY_EPISODE_ASSIGNMENT');
      else featureFlags.disable('SPECIALTY_EPISODE_ASSIGNMENT');
      const updatePatientMultiple = vi.fn().mockResolvedValue(false);
      const { result } = renderHook(() =>
        usePatientRowMainInputHandlers({
          bedId: 'R1',
          currentDateString: '2026-01-03',
          data: DataFactory.createMockPatient('R1'),
          updatePatient: vi.fn(),
          updatePatientMultiple,
        })
      );
      expect(
        await result.current.handleDemographicsSave({ specialty: '', pathology: 'Diagnóstico' })
      ).toBe(false);
      expect(updatePatientMultiple).toHaveBeenCalledExactlyOnceWith('R1', { specialty: '' });
    }
  );

  it('stops the remaining clinical form if the episode or date changes during confirmation', async () => {
    let complete!: (saved: boolean) => void;
    const updatePatientMultiple = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          complete = resolve;
        })
    );
    const initial = {
      date: '2026-01-03',
      data: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'episode-old' }),
    };
    const { result, rerender } = renderHook(
      ({ date, data }) =>
        usePatientRowMainInputHandlers({
          bedId: 'R1',
          currentDateString: date,
          data,
          updatePatient: vi.fn(),
          updatePatientMultiple,
        }),
      { initialProps: initial }
    );
    const saved = result.current.handleDemographicsSave({
      specialty: 'Med Interna',
      pathology: 'Diagnóstico',
    });
    rerender({ date: '2026-01-04', data: { ...initial.data, clinicalEpisodeId: 'episode-new' } });
    complete(true);
    expect(await saved).toBe(false);
    expect(updatePatientMultiple).toHaveBeenCalledTimes(1);
  });

  it('propagates a clinical crib rejection to its caller', async () => {
    const updateClinicalCribMultiple = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      usePatientRowCribInputHandlers({
        bedId: 'R1',
        currentDateString: '2026-01-03',
        data: DataFactory.createMockPatient('C1'),
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple,
      })
    );
    expect(await result.current.handleCribDemographicsSave({ specialty: 'Pediatría' })).toBe(false);
    expect(updateClinicalCribMultiple).toHaveBeenCalledExactlyOnceWith('R1', {
      specialty: 'Pediatría',
    });
  });
  it('accepts the first edit after StrictMode replays effect setup and cleanup', async () => {
    const updatePatientMultiple = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(
      () =>
        usePatientRowMainInputHandlers({
          bedId: 'R1',
          currentDateString: '2026-01-03',
          data: DataFactory.createMockPatient('R1'),
          updatePatient: vi.fn(),
          updatePatientMultiple,
        }),
      { wrapper: StrictMode }
    );
    expect(await result.current.handleDemographicsSave({ specialty: 'Cirugía' })).toBe(true);
    expect(updatePatientMultiple).toHaveBeenCalledExactlyOnceWith('R1', { specialty: 'Cirugía' });
  });

  it('discards an old inline draft when a legacy occupant changes before the timer', () => {
    vi.useFakeTimers();
    const updatePatientMultiple = vi.fn();
    const original = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: undefined,
      rut: '',
      patientName: 'Paciente sintético A',
    });
    const { result, rerender } = renderHook(
      ({ data }) =>
        usePatientRowMainInputHandlers({
          bedId: 'R1',
          currentDateString: '2026-01-03',
          data,
          updatePatient: vi.fn(),
          updatePatientMultiple,
        }),
      { initialProps: { data: original } }
    );
    act(() =>
      result.current.handleTextChange('pathology')({
        target: { value: 'Borrador anterior' },
      } as ChangeEvent<HTMLInputElement>)
    );
    rerender({ data: { ...original, patientName: 'Paciente sintético B' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(updatePatientMultiple).not.toHaveBeenCalled();
  });
});
