import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluidBalanceDetail } from '@/features/census/components/patient-row/FluidBalanceDetail';
import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { DataFactory } from '@/tests/factories/DataFactory';
const balance = {
  censusDate: '2026-11-04',
  day: { intakeMl: 500, urineOutputMl: 200, records: 2 },
  night: { intakeMl: 100, urineOutputMl: 300, records: 2 },
};

describe('minimal balance in clinical detail', () => {
  it('switches between 24 hours, day and night without a new read', () => {
    render(<FluidBalanceDetail balance={balance} censusDate={balance.censusDate} />);
    expect(screen.getByText('600 ml')).toBeInTheDocument();
    expect(screen.getByText('500 ml')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(screen.getByText('200 ml')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Noche' }));
    expect(screen.getByText('100 ml')).toBeInTheDocument();
    expect(screen.getByText('300 ml')).toBeInTheDocument();
  });
  it('does not present yesterday’s carried balance as today’s totals', () => {
    render(<FluidBalanceDetail balance={balance} censusDate="2026-11-05" />);
    expect(screen.getByText(/sin datos sincronizados/)).toBeInTheDocument();
    expect(screen.queryByText('600 ml')).not.toBeInTheDocument();
  });
  it('allows opening detail when only balance is available, without adding volumes to census', async () => {
    render(
      <table>
        <tbody>
          <tr>
            <VitalsCell
              date={balance.censusDate}
              data={DataFactory.createMockPatient('R1', {
                fluidBalance: balance,
                vitalSigns: undefined,
              })}
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.queryByText('600 ml')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(await screen.findByText('600 ml')).toBeInTheDocument();
  });
});
