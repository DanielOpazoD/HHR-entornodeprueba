import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import type { DeviceInstance } from '@/types/domain/devices';
import type { PatientData } from '@/types/domain/patient';

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

  it('bundles generic invasive-device retirement into one atomic patient patch', () => {
    const onDevicesChange = vi.fn();
    const onDeviceDetailsChange = vi.fn();
    const onDeviceHistoryChange = vi.fn();
    const onDeviceBundleChange = vi.fn();

    const { result } = renderHook(() =>
      useDevicesCellController({
        data: buildData({
          devices: ['TET', 'CVC', 'SNG'],
          deviceDetails: {
            TET: { installationDate: '2026-02-13' },
            CVC: { installationDate: '2026-02-14' },
            SNG: { installationDate: '2026-02-15' },
          },
        }),
        onDevicesChange,
        onDeviceDetailsChange,
        onDeviceHistoryChange,
        onDeviceBundleChange,
        dateProvider: () => new Date('2026-02-16T06:00:00'),
      })
    );

    act(() =>
      result.current.handleDeviceRetireChange(['CVC', 'SNG'], {
        TET: {
          installationDate: '2026-02-13',
          removalDate: '2026-02-16',
          note: '[Retiro] extubado',
        },
        CVC: { installationDate: '2026-02-14' },
        SNG: { installationDate: '2026-02-15' },
      })
    );

    expect(onDeviceBundleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        devices: ['CVC', 'SNG'],
        deviceDetails: {
          CVC: { installationDate: '2026-02-14' },
          SNG: { installationDate: '2026-02-15' },
        },
        deviceInstanceHistory: expect.arrayContaining([
          expect.objectContaining({
            type: 'TET',
            status: 'Removed',
            removalDate: '2026-02-16',
            note: '[Retiro] extubado',
          }),
        ]),
      })
    );
    expect(onDevicesChange).not.toHaveBeenCalled();
    expect(onDeviceDetailsChange).not.toHaveBeenCalled();
    expect(onDeviceHistoryChange).not.toHaveBeenCalled();
  });

  it('retires one VVP while preserving the other active VVP and non-VVP devices', () => {
    const onDevicesChange = vi.fn();
    const onDeviceDetailsChange = vi.fn();
    const onDeviceHistoryChange = vi.fn();
    const onDeviceBundleChange = vi.fn();

    const { result } = renderHook(() =>
      useDevicesCellController({
        data: buildData({
          devices: ['VVP#1', 'VVP#2', 'CVC'],
          deviceDetails: {
            'VVP#1': { installationDate: '2026-02-13' },
            'VVP#2': { installationDate: '2026-02-14' },
            CVC: { installationDate: '2026-02-12' },
          },
          deviceInstanceHistory: [
            {
              id: 'vvp-1',
              type: 'VVP#1',
              status: 'Active',
              installationDate: '2026-02-13',
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'vvp-2',
              type: 'VVP#2',
              status: 'Active',
              installationDate: '2026-02-14',
              createdAt: 2,
              updatedAt: 2,
            },
            {
              id: 'cvc-1',
              type: 'CVC',
              status: 'Active',
              installationDate: '2026-02-12',
              createdAt: 3,
              updatedAt: 3,
            },
          ],
        }),
        onDevicesChange,
        onDeviceDetailsChange,
        onDeviceHistoryChange,
        onDeviceBundleChange,
        dateProvider: () => new Date('2026-02-16T06:00:00'),
      })
    );

    act(() =>
      result.current.handleDeviceRetireChange(['VVP#2', 'CVC'], {
        'VVP#1': {
          installationDate: '2026-02-13',
          removalDate: '2026-02-16',
          note: '[Retiro] infiltrada',
        },
        'VVP#2': { installationDate: '2026-02-14' },
        CVC: { installationDate: '2026-02-12' },
      })
    );

    expect(onDeviceBundleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        devices: ['VVP#1', 'CVC'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-14' },
          CVC: { installationDate: '2026-02-12' },
        },
        deviceInstanceHistory: expect.arrayContaining([
          expect.objectContaining({
            type: 'VVP#1',
            status: 'Removed',
            removalDate: '2026-02-16',
          }),
          expect.objectContaining({
            id: 'vvp-2',
            type: 'VVP#1',
            status: 'Active',
          }),
          expect.objectContaining({
            type: 'CVC',
            status: 'Active',
          }),
        ]),
      })
    );
    expect(onDevicesChange).not.toHaveBeenCalled();
    expect(onDeviceDetailsChange).not.toHaveBeenCalled();
    expect(onDeviceHistoryChange).not.toHaveBeenCalled();
  });

  it('keeps a complex invasive-device flow atomic and independent across repeated edits', () => {
    const onDevicesChange = vi.fn();
    const onDeviceDetailsChange = vi.fn();
    const onDeviceHistoryChange = vi.fn();
    const onDeviceBundleChange = vi.fn();

    const baseData = buildData({
      devices: ['VVP#1', 'VVP#2', 'CVC', 'LA', 'CUP'],
      deviceDetails: {
        'VVP#1': { installationDate: '2026-02-10' },
        'VVP#2': { installationDate: '2026-02-11' },
        CVC: { installationDate: '2026-02-09' },
        LA: { installationDate: '2026-02-12' },
        CUP: { installationDate: '2026-02-13' },
      },
      deviceInstanceHistory: [
        {
          id: 'vvp-1',
          type: 'VVP#1',
          status: 'Active',
          installationDate: '2026-02-10',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'vvp-2',
          type: 'VVP#2',
          status: 'Active',
          installationDate: '2026-02-11',
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: 'cvc-1',
          type: 'CVC',
          status: 'Active',
          installationDate: '2026-02-09',
          createdAt: 3,
          updatedAt: 3,
        },
        {
          id: 'la-1',
          type: 'LA',
          status: 'Active',
          installationDate: '2026-02-12',
          createdAt: 4,
          updatedAt: 4,
        },
        {
          id: 'cup-1',
          type: 'CUP',
          status: 'Active',
          installationDate: '2026-02-13',
          createdAt: 5,
          updatedAt: 5,
        },
      ],
    });

    const { result, rerender } = renderHook(
      ({ data }) =>
        useDevicesCellController({
          data,
          onDevicesChange,
          onDeviceDetailsChange,
          onDeviceHistoryChange,
          onDeviceBundleChange,
          dateProvider: () => new Date('2026-02-16T06:00:00'),
        }),
      { initialProps: { data: baseData } }
    );

    act(() =>
      result.current.handleDeviceRetireChange(['VVP#2', 'CVC', 'LA', 'CUP'], {
        'VVP#1': {
          installationDate: '2026-02-10',
          removalDate: '2026-02-16',
          note: '[Retiro] infiltrada',
        },
        'VVP#2': { installationDate: '2026-02-11' },
        CVC: { installationDate: '2026-02-09' },
        LA: { installationDate: '2026-02-12' },
        CUP: { installationDate: '2026-02-13' },
      })
    );

    const afterVvpRetire = onDeviceBundleChange.mock.calls.at(-1)?.[0];
    expect(afterVvpRetire).toEqual(
      expect.objectContaining({
        devices: ['VVP#1', 'CVC', 'LA', 'CUP'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-11' },
          CVC: { installationDate: '2026-02-09' },
          LA: { installationDate: '2026-02-12' },
          CUP: { installationDate: '2026-02-13' },
        },
      })
    );
    expect(afterVvpRetire.deviceInstanceHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'vvp-1', status: 'Removed', type: 'VVP#1' }),
        expect.objectContaining({ id: 'vvp-2', status: 'Active', type: 'VVP#1' }),
        expect.objectContaining({ id: 'cvc-1', status: 'Active', type: 'CVC' }),
        expect.objectContaining({ id: 'la-1', status: 'Active', type: 'LA' }),
        expect.objectContaining({ id: 'cup-1', status: 'Active', type: 'CUP' }),
      ])
    );

    rerender({
      data: {
        ...baseData,
        devices: afterVvpRetire.devices,
        deviceDetails: afterVvpRetire.deviceDetails,
        deviceInstanceHistory: afterVvpRetire.deviceInstanceHistory,
      },
    });

    act(() =>
      result.current.handleDeviceConfigChange(['VVP#1', 'CVC', 'LA', 'CUP', 'VVP#2'], {
        ...afterVvpRetire.deviceDetails,
        'VVP#2': { installationDate: '2026-02-16' },
      })
    );

    const afterNewVvp = onDeviceBundleChange.mock.calls.at(-1)?.[0];
    expect(afterNewVvp).toEqual(
      expect.objectContaining({
        devices: ['VVP#1', 'CVC', 'LA', 'CUP', 'VVP#2'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-11' },
          CVC: { installationDate: '2026-02-09' },
          LA: { installationDate: '2026-02-12' },
          CUP: { installationDate: '2026-02-13' },
          'VVP#2': { installationDate: '2026-02-16' },
        },
      })
    );
    expect(afterNewVvp.deviceInstanceHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'vvp-1', status: 'Removed', type: 'VVP#1' }),
        expect.objectContaining({ id: 'vvp-2', status: 'Active', type: 'VVP#1' }),
        expect.objectContaining({
          status: 'Active',
          type: 'VVP#2',
          installationDate: '2026-02-16',
        }),
        expect.objectContaining({ status: 'Active', type: 'CVC' }),
        expect.objectContaining({ status: 'Active', type: 'LA' }),
        expect.objectContaining({ status: 'Active', type: 'CUP' }),
      ])
    );

    rerender({
      data: {
        ...baseData,
        devices: afterNewVvp.devices,
        deviceDetails: afterNewVvp.deviceDetails,
        deviceInstanceHistory: afterNewVvp.deviceInstanceHistory,
      },
    });

    act(() =>
      result.current.handleDeviceRetireChange(['VVP#1', 'LA', 'CUP', 'VVP#2'], {
        ...afterNewVvp.deviceDetails,
        CVC: {
          installationDate: '2026-02-09',
          removalDate: '2026-02-16',
          note: '[Retiro] retiro CVC',
        },
      })
    );

    const afterCvcRetire = onDeviceBundleChange.mock.calls.at(-1)?.[0];
    expect(afterCvcRetire).toEqual(
      expect.objectContaining({
        devices: ['VVP#1', 'LA', 'CUP', 'VVP#2'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-11' },
          LA: { installationDate: '2026-02-12' },
          CUP: { installationDate: '2026-02-13' },
          'VVP#2': { installationDate: '2026-02-16' },
        },
      })
    );
    expect(afterCvcRetire.deviceInstanceHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'CVC', status: 'Removed', removalDate: '2026-02-16' }),
        expect.objectContaining({ type: 'LA', status: 'Active' }),
        expect.objectContaining({ type: 'CUP', status: 'Active' }),
        expect.objectContaining({ type: 'VVP#1', status: 'Active' }),
        expect.objectContaining({ type: 'VVP#2', status: 'Active' }),
      ])
    );

    expect(onDevicesChange).not.toHaveBeenCalled();
    expect(onDeviceDetailsChange).not.toHaveBeenCalled();
    expect(onDeviceHistoryChange).not.toHaveBeenCalled();
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
