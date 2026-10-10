import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/cudyr/components/CudyrView', () => ({
  CudyrView: ({ currentDate }: { currentDate?: string }) => <div>Diario {currentDate}</div>,
}));
vi.mock('@/features/cudyr/components/CudyrMonthlyIndicator', () => ({
  CudyrMonthlyIndicator: ({ date }: { date: string }) => <div>Mensual {date}</div>,
}));

// Match the real public consumers, which already load the feature through React.lazy.
const Daily = lazy(() => import('@/features/cudyr').then(m => ({ default: m.CudyrView })));
const Monthly = lazy(() =>
  import('@/features/cudyr').then(m => ({ default: m.CudyrMonthlyIndicator }))
);

describe('CUDYR public lazy entries', () => {
  it('renders both views through their existing outer lazy boundary and preserves props', async () => {
    render(
      <Suspense fallback="Cargando">
        <Daily currentDate="2026-08-31" />
        <Monthly date="2026-09-30" />
      </Suspense>
    );
    expect(await screen.findByText('Diario 2026-08-31')).toBeVisible();
    expect(await screen.findByText('Mensual 2026-09-30')).toBeVisible();
  });
});
