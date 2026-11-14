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
    expect(screen.queryByRole('region', { name: 'Ingresos y diuresis' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sin datos sincronizados/)).not.toBeInTheDocument();
    expect(screen.queryByText('600 ml')).not.toBeInTheDocument();
  });
  it('stays absent without a balance or when the day has no records', () => {
    const view = render(<FluidBalanceDetail censusDate={balance.censusDate} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(
      <FluidBalanceDetail
        censusDate={balance.censusDate}
        balance={{
          ...balance,
          day: { intakeMl: 0, urineOutputMl: 0, records: 0 },
          night: { intakeMl: 0, urineOutputMl: 0, records: 0 },
        }}
      />
    );
    expect(view.container).toBeEmptyDOMElement();
  });
  it('retains a recorded zero rather than treating it as missing data', () => {
    render(
      <FluidBalanceDetail
        censusDate={balance.censusDate}
        balance={{
          ...balance,
          day: { intakeMl: 0, urineOutputMl: 0, records: 1 },
          night: { intakeMl: 0, urineOutputMl: 0, records: 0 },
        }}
      />
    );
    expect(screen.getAllByText('0 ml')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Noche' }));
    expect(screen.getByText('Sin registros de ingresos o diuresis en este período.')).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: /^Signos vitales:/ }));
    expect(await screen.findByText('600 ml')).toBeInTheDocument();
  });
});
