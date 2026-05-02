import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CensusRegisterContent } from '@/features/census/components/CensusRegisterContent';

vi.mock('@/features/census/components/CensusActionsContext', () => ({
  CensusActionsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="census-actions-provider">{children}</div>
  ),
}));

vi.mock('@/features/census/components/CensusPrintHeader', () => ({
  CensusPrintHeader: () => <div data-testid="census-print-header" />,
}));

vi.mock('@/features/census/components/CensusStaffHeader', () => ({
  CensusStaffHeader: () => <div data-testid="census-staff-header" />,
}));

vi.mock('@/features/census/components/CensusRegisterMainContent', () => ({
  CensusRegisterMainContent: () => <div data-testid="census-table" />,
}));

vi.mock('@/features/census/components/CensusRegisterSections', () => ({
  CensusRegisterSections: () => <div data-testid="census-register-sections" />,
}));

describe('CensusRegisterContent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the primary census table before deferred secondary sections', async () => {
    vi.useFakeTimers();

    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
      />
    );

    expect(screen.getByTestId('census-staff-header')).toBeInTheDocument();
    expect(screen.getByTestId('census-table')).toBeInTheDocument();
    expect(screen.queryByTestId('census-register-sections')).not.toBeInTheDocument();
    expect(screen.queryByTestId('census-register-sections-loading')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(screen.getByTestId('census-register-sections-loading')).toBeInTheDocument();
  });

  it('does not schedule secondary sections for specialist access', async () => {
    vi.useFakeTimers();

    render(
      <CensusRegisterContent
        currentDateString="2026-03-10"
        readOnly={false}
        beds={{}}
        visibleBeds={[]}
        marginStyle={{}}
        stats={null}
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
        accessProfile="specialist"
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('census-table')).toBeInTheDocument();
    expect(screen.queryByTestId('census-register-sections')).not.toBeInTheDocument();
  });
});
