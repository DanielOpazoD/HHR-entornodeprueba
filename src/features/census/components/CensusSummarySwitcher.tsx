import { lazy, Suspense, useState } from 'react';
import { Bed, ChartNoAxesCombined } from 'lucide-react';
import { CombinedSummaryCard } from '@/components/layout/SummaryCard';
import type { ComponentProps } from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';

const MonthlyCudyr = lazy(() =>
  import('@/features/cudyr').then(module => ({
    default: module.CudyrMonthlyIndicator,
  }))
);

export const CensusSummarySwitcher = ({
  date,
  ...summary
}: ComponentProps<typeof CombinedSummaryCard> & { date: string }) => {
  const [monthly, setMonthly] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <div
      className="relative min-w-0 w-[310px] max-w-full self-stretch"
      data-testid="census-summary-switcher"
    >
      <button
        type="button"
        aria-pressed={monthly}
        aria-label={monthly ? 'Mostrar camas y movimientos' : 'Mostrar cumplimiento CUDYR mensual'}
        title={monthly ? 'Camas y movimientos' : 'Cumplimiento CUDYR mensual'}
        onClick={() => {
          setMonthly(value => !value);
          setOpened(true);
        }}
        className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 print:hidden"
      >
        {monthly ? (
          <Bed size={14} aria-hidden="true" />
        ) : (
          <ChartNoAxesCombined size={14} aria-hidden="true" />
        )}
      </button>
      <div hidden={monthly} className="h-full [&>div]:pr-9 [&>div]:h-full">
        <CombinedSummaryCard {...summary} />
      </div>
      {opened && (
        <div hidden={!monthly} className="h-full">
          <SectionErrorBoundary sectionName="Cumplimiento CUDYR" fallbackHeight="80px">
            <Suspense
              fallback={
                <div
                  role="status"
                  className="min-h-20 rounded-xl border bg-white p-3 text-xs text-slate-500"
                >
                  Leyendo CUDYR…
                </div>
              }
            >
              <MonthlyCudyr date={date} />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  );
};
