import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeferredSystemHealthReporter,
  SYSTEM_HEALTH_REPORTING_ENABLE_DELAY_MS,
} from '@/app-shell/runtime/DeferredSystemHealthReporter';

vi.mock('@/hooks/admin/SystemHealthReporterBridge', () => ({
  SystemHealthReporterBridge: ({ enabled = true }: { enabled?: boolean }) => (
    <div data-testid="system-health-reporter" data-enabled={String(enabled)} />
  ),
}));

describe('DeferredSystemHealthReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers loading the system health reporter until after startup settles', async () => {
    render(<DeferredSystemHealthReporter />);

    expect(screen.queryByTestId('system-health-reporter')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYSTEM_HEALTH_REPORTING_ENABLE_DELAY_MS);
      await vi.dynamicImportSettled();
    });

    expect(screen.getByTestId('system-health-reporter')).toHaveAttribute('data-enabled', 'true');
  });
});
