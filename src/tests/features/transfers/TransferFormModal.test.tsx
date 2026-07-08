import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TransferFormModal } from '@/features/transfers/components/internal/TransferFormModal';

const getDestinationHospitalCatalog = vi.fn();

vi.mock('@/features/transfers/services/destinationHospitalCatalogService', () => ({
  getDestinationHospitalCatalog: (...args: unknown[]) => getDestinationHospitalCatalog(...args),
}));

const mockNotify = vi.fn();
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: mockNotify,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

describe('TransferFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDestinationHospitalCatalog.mockResolvedValue([
      { id: 'salvador', name: 'Hospital Del Salvador', city: 'Santiago' },
      { id: 'otro', name: 'Otro', city: '' },
    ]);
  });

  it('submits the configured request date when creating a transfer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TransferFormModal
        transfer={null}
        patients={[
          { id: 'BED_H5C1', name: 'Paciente Demo', bedId: 'BED_H5C1', diagnosis: 'Dx demo' },
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    const selects = screen.getAllByRole('combobox');
    const patientSelect = selects[0];
    fireEvent.change(patientSelect, { target: { value: 'BED_H5C1' } });

    const requestDateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(requestDateInput).not.toBeNull();
    fireEvent.change(requestDateInput, { target: { value: '2026-03-15' } });

    const hospitalSelect = selects[1];
    fireEvent.change(hospitalSelect, { target: { value: 'Hospital Del Salvador' } });

    fireEvent.click(screen.getByRole('button', { name: /crear solicitud/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'BED_H5C1',
          bedId: 'BED_H5C1',
          requestDate: '2026-03-15',
          destinationHospital: 'Hospital Del Salvador',
        })
      );
    });
  });

  it('includes Pediatría in required specialty and keeps notes management out of the modal', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TransferFormModal
        transfer={null}
        patients={[
          { id: 'BED_H5C1', name: 'Paciente Demo', bedId: 'BED_H5C1', diagnosis: 'Dx demo' },
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'BED_H5C1' } });
    fireEvent.change(selects[1], { target: { value: 'Hospital Del Salvador' } });

    expect(screen.getByRole('option', { name: 'Pediatría' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/agregar nota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/notas del traslado/i)).not.toBeInTheDocument();

    fireEvent.change(selects[2], { target: { value: 'Pediatría' } });

    fireEvent.click(screen.getByRole('button', { name: /crear solicitud/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredSpecialty: 'Pediatría',
        })
      );
    });
  });
});
