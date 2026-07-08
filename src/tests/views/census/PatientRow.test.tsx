import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BEDS } from '@/constants/beds';
import { PatientRow } from '@/features/census/components/PatientRow';
import { usePatientRowBindingsModel } from '@/features/census/components/patient-row/usePatientRowBindingsModel';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/patient-row/usePatientRowBindingsModel', () => ({
  usePatientRowBindingsModel: vi.fn(),
}));

vi.mock('@/features/census/components/patient-row/PatientMainRowView', () => ({
  PatientMainRowView: () => <tr data-testid="main-row-view" />,
}));

vi.mock('@/features/census/components/patient-row/PatientSubRowView', () => ({
  PatientSubRowView: () => <tr data-testid="sub-row-view" />,
}));

vi.mock('@/features/census/components/patient-row/PatientRowModals', () => ({
  PatientRowModals: () => <tr data-testid="row-modals" />,
}));

describe('PatientRow', () => {
  const bindings = {
    mainRowProps: {} as never,
    subRowProps: {} as never,
    modalsProps: {
      showDemographics: true,
      showClinicalDocuments: false,
      canOpenClinicalDocuments: false,
      showExamRequest: false,
      canOpenExamRequest: true,
      showImagingRequest: false,
      canOpenImagingRequest: true,
      showHistory: false,
      canOpenHistory: true,
    } as never,
  };

  it('renders main row view and modals for primary patient rows', async () => {
    vi.mocked(usePatientRowBindingsModel).mockReturnValue(bindings);

    render(
      <table>
        <tbody>
          <PatientRow
            bed={BEDS[0]}
            bedType={BEDS[0].type}
            data={DataFactory.createMockPatient('R1')}
            currentDateString="2026-03-05"
            onAction={vi.fn()}
            isSubRow={false}
          />
        </tbody>
      </table>
    );

    expect(screen.getByTestId('main-row-view')).toBeInTheDocument();
    expect(screen.queryByTestId('sub-row-view')).not.toBeInTheDocument();
    expect(
      await screen.findByTestId('row-modals', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
  });

  it('renders sub row view and modals for clinical crib rows', async () => {
    vi.mocked(usePatientRowBindingsModel).mockReturnValue(bindings);

    render(
      <table>
        <tbody>
          <PatientRow
            bed={BEDS[0]}
            bedType={BEDS[0].type}
            data={DataFactory.createMockPatient('R1-crib')}
            currentDateString="2026-03-05"
            onAction={vi.fn()}
            isSubRow={true}
          />
        </tbody>
      </table>
    );

    expect(screen.queryByTestId('main-row-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('sub-row-view')).toBeInTheDocument();
    expect(
      await screen.findByTestId('row-modals', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
  });
});
