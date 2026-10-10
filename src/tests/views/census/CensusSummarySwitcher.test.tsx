import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { CensusSummarySwitcher } from '@/features/census/components/CensusSummarySwitcher';

const reads = vi.hoisted(() => vi.fn());
vi.mock('@/features/cudyr', () => ({
  CudyrMonthlyIndicator: ({ date }: { date: string }) => {
    reads(date);
    return <section aria-label="Cumplimiento CUDYR mensual">83% · {date}</section>;
  },
}));

describe('Census summary toggle', () => {
  it('opens monthly CUDYR on demand, returns to beds, and follows the selected month', async () => {
    const view = render(
      <CensusSummarySwitcher date="2026-08-31" stats={DataFactory.createMockStatistics()} />
    );
    expect(reads).not.toHaveBeenCalled();
    expect(screen.getByText('Censo Camas')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar cumplimiento CUDYR mensual' }));
    expect(await screen.findByRole('region', { name: 'Cumplimiento CUDYR mensual' })).toBeVisible();
    expect(screen.getByText('Censo Camas')).not.toBeVisible();
    view.rerender(
      <CensusSummarySwitcher date="2026-09-30" stats={DataFactory.createMockStatistics()} />
    );
    expect(screen.getByText('83% · 2026-09-30')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar camas y movimientos' }));
    expect(screen.getByText('Censo Camas')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Cumplimiento CUDYR mensual', hidden: true })
    ).not.toBeVisible();
  });
});
