import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientSubRowView } from '@/features/census/components/patient-row/PatientSubRowView';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/patient-row/PatientInputCells', () => ({
  PatientInputCells: () => <td data-testid="sub-input-cells" />,
}));

describe('PatientSubRowView', () => {
  const baseProps = {
    data: DataFactory.createMockPatient('R1'),
    currentDateString: '2026-02-15',
    style: undefined,
    onOpenDemographics: vi.fn(),
    onChange: {
      text: vi.fn(),
      check: vi.fn(),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      multiple: vi.fn(),
    },
  };

  it('shows demographics shortcut when editable', () => {
    render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly={false} />
        </tbody>
      </table>
    );

    expect(screen.getByTitle('Datos demográficos')).toBeInTheDocument();
    expect(screen.getByTestId('sub-input-cells')).toBeInTheDocument();
  });

  it('hides demographics shortcut when read-only', () => {
    render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly={true} />
        </tbody>
      </table>
    );

    expect(screen.queryByTitle('Datos demográficos')).not.toBeInTheDocument();
  });
});
