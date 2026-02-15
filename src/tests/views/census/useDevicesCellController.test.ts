import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import { DeviceInstance, PatientData } from '@/types';

const buildData = (overrides: Partial<PatientData> = {}): PatientData =>
  ({
    patientName: 'Paciente',
    devices: ['CVC'],
    deviceDetails: {},
    deviceInstanceHistory: [],
    ...overrides,
  }) as PatientData;

describe('useDevicesCellController', () => {
  it('toggles history modal state', () => {
    const { result } = renderHook(() =>
      useDevicesCellController({
        data: buildData(),
        onDevicesChange: vi.fn(),
        onDeviceDetailsChange: vi.fn(),
        onDeviceHistoryChange: vi.fn(),
      })
    );

    expect(result.current.isHistoryOpen).toBe(false);
    act(() => result.current.openHistory());
    expect(result.current.isHistoryOpen).toBe(true);
    act(() => result.current.closeHistory());
    expect(result.current.isHistoryOpen).toBe(false);
  });

  it('emits devices update and history sync on selection changes', () => {
    const onDevicesChange = vi.fn();
    const onDeviceDetailsChange = vi.fn();
    const onDeviceHistoryChange = vi.fn();

    const { result } = renderHook(() =>
      useDevicesCellController({
        data: buildData(),
        onDevicesChange,
        onDeviceDetailsChange,
        onDeviceHistoryChange,
        dateProvider: () => new Date('2026-02-15T06:00:00'),
      })
    );

    act(() => result.current.handleDevicesChange([]));

    expect(onDevicesChange).toHaveBeenCalledWith([]);
    expect(onDeviceHistoryChange).toHaveBeenCalledTimes(1);
    const historyPayload = onDeviceHistoryChange.mock.calls[0][0];
    expect(historyPayload[0].removalDate).toBe('2026-02-15');
    expect(onDeviceDetailsChange).not.toHaveBeenCalled();
  });

  it('maps modal save into history + active devices updates', () => {
    const onDevicesChange = vi.fn();
    const onDeviceDetailsChange = vi.fn();
    const onDeviceHistoryChange = vi.fn();

    const { result } = renderHook(() =>
      useDevicesCellController({
        data: buildData(),
        onDevicesChange,
        onDeviceDetailsChange,
        onDeviceHistoryChange,
      })
    );

    const savedHistory: DeviceInstance[] = [
      {
        id: 'x1',
        type: 'CVC',
        installationDate: '2026-02-14',
        status: 'Active',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    act(() => result.current.handleHistoryModalSave(savedHistory));

    expect(onDeviceHistoryChange).toHaveBeenCalledWith(savedHistory);
    expect(onDevicesChange).toHaveBeenCalledWith(['CVC']);
  });
});
