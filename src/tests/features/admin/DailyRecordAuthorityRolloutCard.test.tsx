import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyRecordAuthorityRolloutCard } from '@/features/admin/components/internal/functionsTelemetry/DailyRecordAuthorityRolloutCard';
import type { DailyRecordAuthorityRolloutSummary } from '@/types/functionsTelemetry';

const makeSummary = (
  overrides: Partial<DailyRecordAuthorityRolloutSummary> = {}
): DailyRecordAuthorityRolloutSummary => ({
  total: 5,
  shadowRuns: 5,
  enforcedWrites: 0,
  successCount: 5,
  failureCount: 0,
  blockedCount: 0,
  permissionDeniedCount: 0,
  fallbackEpisodeKeys: 1,
  degenerateFallbackEpisodeKeys: 0,
  lastEntryAt: '2026-05-14T10:04:00.000Z',
  recommendation: 'ready_for_enforced',
  ...overrides,
});

describe('DailyRecordAuthorityRolloutCard', () => {
  it('shows shadow rollout evidence when authority telemetry is ready for enforced mode', () => {
    render(<DailyRecordAuthorityRolloutCard summary={makeSummary()} />);

    expect(screen.getByText('Autoridad censo diario')).toBeInTheDocument();
    expect(screen.getByText('Listo para enforced')).toBeInTheDocument();
    expect(screen.getByText('Shadow')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Fallback episodeKey/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('surfaces blocking evidence before enabling enforced mode', () => {
    render(
      <DailyRecordAuthorityRolloutCard
        summary={makeSummary({
          failureCount: 1,
          blockedCount: 1,
          permissionDeniedCount: 1,
          degenerateFallbackEpisodeKeys: 2,
          recommendation: 'investigate',
        })}
      />
    );

    expect(screen.getByText('Investigar antes de activar')).toBeInTheDocument();
    expect(screen.getByText('Bloqueos')).toBeInTheDocument();
    expect(screen.getByText('Permisos')).toBeInTheDocument();
    expect(screen.getByText('Fallback degenerado')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
