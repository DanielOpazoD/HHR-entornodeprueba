import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DeviceHistoryModal } from '@/features/census/components/patient-row/DeviceHistoryModal';

describe('DeviceHistoryModal', () => {
  it('backfills missing active device from currentDevices and saves merged history', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <DeviceHistoryModal
        patientName="Paciente Test"
        history={[]}
        currentDevices={['CVC']}
        deviceDetails={{ CVC: { installationDate: '2026-02-14' } }}
        onSave={onSave}
        onClose={onClose}
      />
    );

    expect(screen.getAllByText('CVC').length).toBeGreaterThan(0);
    expect(screen.getByText('Activo')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Guardar Cambios'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(
      payload.some(
        (item: { type: string; status: string }) => item.type === 'CVC' && item.status === 'Active'
      )
    ).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
