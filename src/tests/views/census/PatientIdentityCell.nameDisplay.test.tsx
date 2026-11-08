import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));

const renderCell = (data: ReturnType<typeof DataFactory.createMockPatient>) =>
  render(
    <UIProvider>
      <table>
        <tbody>
          <tr>
            <PatientIdentityCell
              data={data}
              hasRutError={false}
              onNameChange={() => vi.fn()}
              onOpenDemographics={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    </UIProvider>
  );

describe('PatientIdentityCell · displayed name', () => {
  it('shows the first three given names while the value hook keeps the stored name', () => {
    const storedName = 'Ana María de los Ángeles Valentina Rosa Elena Hotu Pakarati';
    const data = DataFactory.createMockPatient('R1', {
      patientName: storedName,
      firstName: 'Ana María de los Ángeles Valentina Rosa Elena',
      lastName: 'Hotu',
      secondLastName: 'Pakarati',
    });

    const { container } = renderCell(data);

    expect(screen.getByText('Ana María de los Ángeles Hotu Pakarati')).toBeInTheDocument();
    expect(screen.queryByText(storedName)).toBeNull();
    expect(container.querySelector('input[name="patientName"]')).toHaveValue(storedName);
  });
});
