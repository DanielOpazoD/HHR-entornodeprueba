import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import type { DeviceInstance } from '@/types/domain/devices';
import { usePatientRowCommandHandlers } from '@/features/census/components/patient-row/usePatientRowCommandHandlers';

describe('usePatientRowCommandHandlers', () => {
  it('turns each row event into the field update the row saves', () => {
    const updateField = vi.fn();
    const updateMultiple = vi.fn();

    const { result } = renderHook(() =>
      usePatientRowCommandHandlers({ updateField, updateMultiple })
    );

    act(() => {
      result.current.handleTextChange('patientName')({
        target: { value: 'Paciente X' },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleCheckboxChange('isUPC')({
        target: { checked: true },
      } as ChangeEvent<HTMLInputElement>);
      result.current.handleDevicesChange(['VMI']);
      result.current.handleDeviceDetailsChange({
        VMI: { installationDate: '2026-02-16', note: 'Detalle' },
      });
      const history: DeviceInstance[] = [
        {
          id: 'h1',
          type: 'VMI',
          installationDate: '2026-02-16',
          status: 'Active',
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      result.current.handleDeviceHistoryChange(history);
      result.current.handleDemographicsSave({ age: '40' });
    });

    expect(updateField).toHaveBeenCalledWith('patientName', 'Paciente X');
    expect(updateField).toHaveBeenCalledWith('isUPC', true);
    expect(updateField).toHaveBeenCalledWith('devices', ['VMI']);
    expect(updateField).toHaveBeenCalledWith('deviceDetails', {
      VMI: { installationDate: '2026-02-16', note: 'Detalle' },
    });
    expect(updateField).toHaveBeenCalledWith(
      'deviceInstanceHistory',
      expect.arrayContaining([expect.objectContaining({ id: 'h1' })])
    );
    expect(updateField).toHaveBeenCalledTimes(5);
    expect(updateMultiple).toHaveBeenCalledWith({ age: '40' });
  });
});
