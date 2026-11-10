import React from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';
import * as browserClipboardRuntime from '@/shared/runtime/browserClipboardRuntime';
import type { DebouncedTextHandler } from '@/features/census/components/patient-row/inputCellTypes';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

const mockedStaffContext = vi.hoisted(() => ({
  professionalsCatalog: [] as ProfessionalCatalogItem[],
}));

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => mockedStaffContext,
}));

const noopChange: DebouncedTextHandler = () => vi.fn();

const renderCell = (props?: Partial<React.ComponentProps<typeof PatientIdentityCell>>) =>
  render(
    <UIProvider>
      <table>
        <tbody>
          <tr>
            <PatientIdentityCell
              data={DataFactory.createMockPatient('R1')}
              hasRutError={false}
              onNameChange={noopChange}
              onOpenDemographics={vi.fn()}
              {...props}
            />
          </tr>
        </tbody>
      </table>
    </UIProvider>
  );

describe('PatientIdentityCell keyboard actions', () => {
  it.each(['{Enter}', ' '])('copies the focused RUN once with %s', async key => {
    const user = userEvent.setup();
    const copy = vi
      .spyOn(browserClipboardRuntime, 'writeClipboardText')
      .mockResolvedValue(undefined);
    try {
      renderCell({
        readOnly: true,
        data: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente Sintético',
          rut: '12.345.678-5',
          age: '',
          specialty: '',
        }),
      });
      await user.tab();
      expect(screen.getByRole('button', { name: 'Copiar RUN 12.345.678-5' })).toHaveFocus();
      await user.keyboard(key);
      expect(copy).toHaveBeenCalledExactlyOnceWith('12.345.678-5');
    } finally {
      copy.mockRestore();
    }
  });

  it('keeps passports as text without copying on click or keyboard', async () => {
    const user = userEvent.setup();
    const copy = vi
      .spyOn(browserClipboardRuntime, 'writeClipboardText')
      .mockResolvedValue(undefined);
    try {
      renderCell({
        data: DataFactory.createMockPatient('R1', { rut: 'AB123456', documentType: 'Pasaporte' }),
      });
      expect(screen.queryByRole('button', { name: /Copiar RUN/ })).not.toBeInTheDocument();
      await user.click(screen.getByText('AB123456'));
      await user.keyboard('{Enter} ');
      expect(copy).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  });
});
