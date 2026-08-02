import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoresCell } from '@/features/census/components/patient-row/ScoresCell';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/rayen-import', () => ({
  useRayenFillStatus: () => false,
}));

describe('ScoresCell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(status).toHaveClass('border-slate-200', 'bg-slate-50', 'text-slate-500');
    expect(status).not.toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-700');
  });

  it('shows Eloísa risk wording without changing the local Braden cadence', () => {
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
                },
              })}
              currentDateString="2026-07-11"
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de escalas de enfermería' }));

    expect(screen.getByText('Riesgo alto')).toBeInTheDocument();
    expect(screen.getByText('Faltan 2 días para repetir la escala')).toBeInTheDocument();
    expect(screen.getByText(/Cada 3 días/)).toBeInTheDocument();
  });
});
