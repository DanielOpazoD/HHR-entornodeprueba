import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoresCell } from '@/features/census/components/patient-row/ScoresCell';
import { NursingScalesVisibleContext } from '@/features/census/hooks/useNursingScalesVisible';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/rayen-import', () => ({
  useRayenFillStatus: () => false,
}));

describe('ScoresCell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['CMA_NEO1', 'BOX4'])(
    'does not request a night CUDYR for an excluded source assignment %s',
    bedId => {
      render(
        <table>
          <tbody>
            <tr>
              <ScoresCell
                data={DataFactory.createMockPatient(bedId, {
                  admissionDate: '2026-07-15',
                  evaluationScores: undefined,
                  cudyr: undefined,
                })}
                currentDateString="2026-07-16"
              />
            </tr>
          </tbody>
        </table>
      );
      expect(screen.queryByTestId('cudyr-pending-status')).not.toBeInTheDocument();
    }
  );

  it('keeps the normal night application window visually neutral', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T07:00:00.000Z')); // 01:00 Rapa Nui

    render(
      <table>
        <tbody>
          <tr>
            <ScoresCell
              data={DataFactory.createMockPatient('H2C1', {
                admissionDate: '2026-07-15',
                evaluationScores: undefined,
                cudyr: undefined,
              })}
              currentDateString="2026-07-16"
            />
          </tr>
        </tbody>
      </table>
    );

    const status = screen.getByTestId('cudyr-pending-status');
    expect(status).toHaveTextContent('Programado · turno noche');
    expect(status).toHaveClass('border-transparent', 'text-slate-500');
    expect(status).not.toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-700');
  });

  it.each([false, true])('does not schedule CUDYR for a crib (attached: %s)', isSubRow => {
    render(
      <table>
        <tbody>
          <tr>
            <ScoresCell
              data={DataFactory.createMockPatient('H2C1', {
                bedMode: 'Cuna',
                admissionDate: '2026-07-15',
                evaluationScores: undefined,
                cudyr: undefined,
              })}
              isSubRow={isSubRow}
              currentDateString="2026-07-16"
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.queryByTestId('cudyr-pending-status')).not.toBeInTheDocument();
  });

  it('keeps a synchronized CUDYR visible even for an excluded crib', () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScoresCell
              data={DataFactory.createMockPatient('H2C1', {
                bedMode: 'Cuna',
                admissionDate: '2026-07-15',
                evaluationScores: {
                  cudyr: {
                    category: 'C2',
                    dependencyScore: 9,
                    riskScore: 7,
                    recordedDate: '2026-07-16',
                    recordedAt: '2026-07-17T04:00:00-06:00',
                    source: 'gestión camas',
                  },
                },
              })}
              isSubRow
              currentDateString="2026-07-16"
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText('C2')).toBeVisible();
    const name = 'Escalas de enfermería: CUDYR C2. Abrir detalle';
    expect(screen.getByRole('button', { name })).not.toHaveAttribute('title');
    expect(screen.queryByTestId('cudyr-pending-status')).not.toBeInTheDocument();
  });

  it('preserves the CUDYR night and pending state while nursing scales are hidden, then shows them again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T07:00:00Z'));
    const patient = DataFactory.createMockPatient('H2C1', {
      age: '45',
      admissionDate: '2026-07-15',
      cudyr: undefined,
      evaluationScores: {
        braden: {
          code: 'BRADEN',
          name: 'Braden',
          encounterEventId: 1,
          total: 14,
          severity: 'Riesgo medio',
          recordedDate: '2026-07-16',
          recordedAt: '2026-07-16T12:00:00-06:00',
        },
        downton: {
          code: 'DOWNTON',
          name: 'Downton',
          encounterEventId: 2,
          total: 2,
          severity: 'Riesgo bajo',
          recordedDate: '2026-07-16',
          recordedAt: '2026-07-16T12:00:00-06:00',
        },
        cudyr: {
          category: 'C2',
          recordedDate: '2026-07-16',
          recordedAt: '2026-07-17T04:00:00-06:00',
          source: 'gestión camas',
        },
      },
    });
    const cell = (visible: boolean, day: string) => (
      <NursingScalesVisibleContext.Provider value={visible}>
        <table>
          <tbody>
            <tr>
              <ScoresCell data={patient} currentDateString={day} />
            </tr>
          </tbody>
        </table>
      </NursingScalesVisibleContext.Provider>
    );
    const { rerender } = render(cell(false, '2026-07-16'));
    expect(
      screen.getByRole('button', { name: 'Escalas de enfermería: CUDYR C2. Abrir detalle' })
    ).toBeVisible();
    expect(screen.queryByTestId('cudyr-pending-status')).toBeNull();

    rerender(cell(false, '2026-07-17'));
    expect(screen.queryByText('C2')).toBeNull();
    expect(screen.getByTestId('cudyr-pending-status')).toHaveTextContent(
      'Programado · turno noche'
    );

    rerender(cell(true, '2026-07-16'));
    expect(screen.getByRole('button', { name: /Braden 14.*Downton 2.*CUDYR C2/ })).toBeVisible();
  });

  it('shows Eloísa risk wording without changing the local Braden cadence', async () => {
    render(
      <table>
        <tbody>
          <tr>
            <ScoresCell
              data={DataFactory.createMockPatient('H2C1', {
                age: '59',
                evaluationScores: {
                  braden: {
                    code: 'BRADEN',
                    name: 'Escala de riesgo UPP (Braden)',
                    encounterEventId: 20260710080000,
                    total: 14,
                    severity: 'Riesgo alto',
                    recordedDate: '2026-07-10',
                    recordedAt: '2026-07-10T08:00:00-06:00',
                  },
                  downton: {
                    code: 'DOWNTON',
                    name: 'Downton',
                    encounterEventId: 20260710080001,
                    total: 2,
                    severity: 'Riesgo bajo',
                    recordedDate: '2026-07-10',
                    recordedAt: '2026-07-10T08:00:00-06:00',
                  },
                },
              })}
              currentDateString="2026-07-11"
            />
          </tr>
        </tbody>
      </table>
    );

    const name =
      'Escalas de enfermería: Braden 14, Riesgo alto, Faltan 2 días para repetir la escala; ' +
      'Downton 2, Riesgo bajo, Faltan 6 días para repetir la escala. Abrir detalle';
    expect(screen.getByRole('button', { name })).not.toHaveAttribute('title');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Escalas de enfermería:/ }));
      // Wait for the real lazy module, not a wall-clock-dependent query timeout.
      await import('@/features/census/components/patient-row/ScoresDetailModal');
    });

    expect(screen.getByText('Riesgo alto')).toBeInTheDocument();
    expect(screen.getByText('Faltan 2 días para repetir la escala')).toBeInTheDocument();
    expect(screen.getByText(/Cada 3 días/)).toBeInTheDocument();
  });

  it('opens the CUDYR detail tab when clicking the pending night-shift indicator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T07:00:00.000Z')); // 01:00 Rapa Nui

    render(
      <table>
        <tbody>
          <tr>
            <ScoresCell
              data={DataFactory.createMockPatient('H2C1', {
                admissionDate: '2026-07-15',
                clinicalEpisodeId: '800101',
                evaluationScores: undefined,
                cudyr: undefined,
              })}
              currentDateString="2026-07-16"
            />
          </tr>
        </tbody>
      </table>
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('cudyr-pending-status'));
      await import('@/features/census/components/patient-row/ScoresDetailModal');
    });

    expect(screen.getByRole('tab', { name: 'CUDYR' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Sin resultado vigente de CUDYR para este día.')).toBeInTheDocument();
    expect(screen.getByText(/Turno noche en curso/)).toBeInTheDocument();
  });
});
