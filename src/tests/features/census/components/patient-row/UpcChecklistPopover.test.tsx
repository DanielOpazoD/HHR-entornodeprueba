import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UpcChecklistPopover } from '@/features/census/components/patient-row/UpcChecklistPopover';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('UpcChecklistPopover', () => {
  it('keeps the saved UPC classification visible even before the external checklist prop rehydrates', async () => {
    const onSave = vi.fn();

    render(
      <table>
        <tbody>
          <tr>
            <UpcChecklistPopover
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente UPC',
                rut: '12.345.678-9',
              })}
              checklist={undefined}
              onSave={onSave}
              eligible={true}
              actor={{ uid: 'user-1', displayName: 'Test User' }}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle(/sin clasificación upc/i));

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Monitorización cardíaca continua/i })
    );

    // La escritura viaja coalescida (~400 ms); la UI es optimista al instante.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'UPC_UTI',
        utiCriteria: ['uti_mon_cardiaca'],
      })
    );

    expect(screen.getByRole('button', { name: 'UTI' })).toBeInTheDocument();
    expect(
      await screen.findByRole('checkbox', { name: /Monitorización cardíaca continua/i })
    ).toBeChecked();
  });

  it('shows legacy UPC checkbox records as UTI in the row badge', () => {
    render(
      <table>
        <tbody>
          <tr>
            <UpcChecklistPopover
              data={DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Legado',
                rut: '44.444.444-4',
                isUPC: true,
              })}
              checklist={undefined}
              onSave={vi.fn()}
              eligible={true}
              actor={{ uid: 'user-1', displayName: 'Test User' }}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByRole('button', { name: 'UTI' })).toBeInTheDocument();
  });
});
