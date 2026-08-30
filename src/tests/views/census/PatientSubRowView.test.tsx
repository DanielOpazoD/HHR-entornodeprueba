import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientSubRowView } from '@/features/census/components/patient-row/PatientSubRowView';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/patient-row/PatientInputCells', () => ({
  PatientInputCells: ({ diagnosisMode }: { diagnosisMode?: string }) => (
    <td data-testid="sub-input-cells" data-diagnosis-mode={diagnosisMode} />
  ),
}));

describe('PatientSubRowView', () => {
  const baseProps = {
    data: DataFactory.createMockPatient('R1'),
    currentDateString: '2026-02-15',
    diagnosisMode: 'cie10' as const,
    style: undefined,
    onOpenDemographics: vi.fn(),
    onOpenHistory: vi.fn(),
    onRemoveClinicalCrib: vi.fn().mockResolvedValue(undefined),
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

    expect(screen.getByTitle('Datos del Paciente')).toBeInTheDocument();
    expect(screen.getByTitle('Acciones')).toBeInTheDocument();
    expect(screen.getByTestId('sub-input-cells')).toBeInTheDocument();
    expect(screen.getByTestId('sub-input-cells')).toHaveAttribute('data-diagnosis-mode', 'cie10');
  });

  it('hides demographics shortcut when read-only', () => {
    render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly={true} />
        </tbody>
      </table>
    );

    expect(screen.queryByTitle('Datos del Paciente')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Acciones')).not.toBeInTheDocument();
  });

  it('hides demographics shortcut for specialist census access even when editable', () => {
    render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} accessProfile="specialist" readOnly={false} />
        </tbody>
      </table>
    );

    expect(screen.queryByTitle('Datos del Paciente')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Acciones')).not.toBeInTheDocument();
  });

  it('renders attached clinical cribs with a white row background', () => {
    const { container } = render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly={false} />
        </tbody>
      </table>
    );

    const row = container.querySelector('tr[data-testid="patient-row"]');

    expect(row).toHaveClass('bg-white');
    expect(row).toHaveClass('hover:bg-white');
  });

  it('keeps the crib action and bed labels aligned with the main census columns', () => {
    const { container } = render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly={false} />
        </tbody>
      </table>
    );

    const row = container.querySelector('tr[data-testid="patient-row"]');

    // The mocked PatientInputCells contributes one cell. The sub-row must contribute exactly the
    // two leading table cells used by every main row: actions and bed. A third leading cell shifts
    // the complete fixed-layout table, which was the regression seen after adding an attached crib.
    expect(row?.querySelectorAll(':scope > td')).toHaveLength(3);
  });

  it('locks only the crib row and shows progress while remote deletion is pending', () => {
    const { container } = render(
      <table>
        <tbody>
          <PatientSubRowView {...baseProps} readOnly isPendingClear />
        </tbody>
      </table>
    );

    const row = container.querySelector('tr[data-testid="patient-row"]');
    expect(row).toHaveAttribute('aria-busy', 'true');
    expect(row).toHaveAttribute('data-clear-pending', 'true');
    expect(screen.getByRole('status')).toHaveAccessibleName('Confirmando limpieza de la cuna');
    expect(screen.queryByTitle('Acciones')).not.toBeInTheDocument();
  });
});
