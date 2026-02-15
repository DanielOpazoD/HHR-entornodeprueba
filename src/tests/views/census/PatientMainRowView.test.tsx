import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientMainRowView } from '@/features/census/components/patient-row/PatientMainRowView';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BEDS } from '@/constants';

vi.mock('@/features/census/components/patient-row/PatientMainRowActionCell', () => ({
  PatientMainRowActionCell: (props: {
    onViewExamRequest?: () => void;
    onViewHistory?: () => void;
  }) => (
    <td
      data-testid="action-cell"
      data-exam={String(Boolean(props.onViewExamRequest))}
      data-history={String(Boolean(props.onViewHistory))}
    />
  ),
}));

vi.mock('@/features/census/components/patient-row/PatientBedConfig', () => ({
  PatientBedConfig: () => <td data-testid="bed-config" />,
}));

vi.mock('@/features/census/components/patient-row/PatientMainRowBedTypeCell', () => ({
  PatientMainRowBedTypeCell: () => <td data-testid="bed-type-cell" />,
}));

vi.mock('@/features/census/components/patient-row/PatientMainRowBlockedCell', () => ({
  PatientMainRowBlockedCell: () => <td data-testid="blocked-cell" />,
}));

vi.mock('@/features/census/components/patient-row/PatientInputCells', () => ({
  PatientInputCells: () => <td data-testid="input-cells" />,
}));

describe('PatientMainRowView', () => {
  const baseProps = {
    bed: BEDS[0],
    bedType: BEDS[0].type,
    data: DataFactory.createMockPatient('R1'),
    currentDateString: '2026-02-15',
    readOnly: false,
    actionMenuAlign: 'top' as const,
    diagnosisMode: 'free' as const,
    isBlocked: false,
    isEmpty: false,
    hasCompanion: false,
    hasClinicalCrib: false,
    isCunaMode: false,
    mainRowViewState: {
      canToggleBedType: true,
      rowClassName: 'row',
      rowActionsAvailability: { canOpenExamRequest: true, canOpenHistory: true },
      showBlockedContent: false,
    },
    onAction: vi.fn(),
    onOpenDemographics: vi.fn(),
    onOpenExamRequest: vi.fn(),
    onOpenHistory: vi.fn(),
    onToggleMode: vi.fn(),
    onToggleCompanion: vi.fn(),
    onToggleClinicalCrib: vi.fn(),
    onToggleBedType: vi.fn(),
    onUpdateClinicalCrib: vi.fn(),
    onChange: {
      text: vi.fn(),
      check: vi.fn(),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    },
  };

  it('renders input cells when row is not blocked', () => {
    render(
      <table>
        <tbody>
          <PatientMainRowView {...baseProps} />
        </tbody>
      </table>
    );

    expect(screen.getByTestId('input-cells')).toBeInTheDocument();
    expect(screen.queryByTestId('blocked-cell')).not.toBeInTheDocument();
  });

  it('renders blocked content when row is blocked', () => {
    render(
      <table>
        <tbody>
          <PatientMainRowView
            {...baseProps}
            mainRowViewState={{
              ...baseProps.mainRowViewState,
              showBlockedContent: true,
            }}
          />
        </tbody>
      </table>
    );

    expect(screen.getByTestId('blocked-cell')).toBeInTheDocument();
    expect(screen.queryByTestId('input-cells')).not.toBeInTheDocument();
  });
});
