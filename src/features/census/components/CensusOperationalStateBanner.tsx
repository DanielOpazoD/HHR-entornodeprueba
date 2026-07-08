import React from 'react';
import clsx from 'clsx';
import type { CensusOperationalState } from '@/features/census/controllers/censusOperationalStateController';

interface CensusOperationalStateBannerProps {
  state: CensusOperationalState;
}

export const CensusOperationalStateBanner: React.FC<CensusOperationalStateBannerProps> = ({
  state,
}) => {
  if (!state.shouldShowBanner) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={clsx(
        'rounded-lg border px-3 py-2 text-xs shadow-sm print:hidden',
        state.severity === 'error' && 'border-red-200 bg-red-50 text-red-800',
        state.severity === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
        state.severity === 'info' && 'border-sky-200 bg-sky-50 text-sky-800'
      )}
      data-phase={state.phase}
      data-testid="census-operational-state-banner"
      role="status"
    >
      <span className="font-bold">{state.label}</span>
      <span className="ml-2">{state.message}</span>
    </div>
  );
};
