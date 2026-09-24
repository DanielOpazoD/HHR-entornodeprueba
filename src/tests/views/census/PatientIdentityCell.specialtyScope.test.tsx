import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));
vi.mock('@/features/census/components/patient-row/SpecialtyChip', () => ({
  SpecialtyChip: ({ scope }: { scope?: { bedId: string; target: string; episodeId: string } }) => (
    <span
      data-testid="specialty-scope"
      data-bed-id={scope?.bedId}
      data-target={scope?.target}
      data-episode-id={scope?.episodeId}
    />
  ),
}));

const renderCrib = (parentBedId?: string) =>
  render(
    <UIProvider>
      <table>
        <tbody>
          <tr>
            <PatientIdentityCell
              data={DataFactory.createMockPatient('H5C1-CUNA', {
                patientName: 'RN sintético',
                clinicalEpisodeId: 'neo-episode',
              })}
              isSubRow
              parentBedId={parentBedId}
              currentDateString="2026-09-23"
              hasRutError={false}
              onNameChange={() => vi.fn()}
              onOpenDemographics={vi.fn()}
            />
          </tr>
        </tbody>
      </table>
    </UIProvider>
  );

describe('clinical-crib specialty scope', () => {
  it('addresses the parent bed while retaining the newborn episode and crib target', () => {
    renderCrib('H5C1');
    expect(screen.getByTestId('specialty-scope')).toHaveAttribute('data-bed-id', 'H5C1');
    expect(screen.getByTestId('specialty-scope')).toHaveAttribute('data-target', 'clinicalCrib');
    expect(screen.getByTestId('specialty-scope')).toHaveAttribute('data-episode-id', 'neo-episode');
  });

  it('does not use the crib identifier as a fallback bed address', () => {
    renderCrib();
    expect(screen.getByTestId('specialty-scope')).not.toHaveAttribute('data-bed-id');
  });
});
