import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RayenClinicalEnrichmentRolloutCard } from '@/features/admin/components/internal/functionsTelemetry/RayenClinicalEnrichmentRolloutCard';
import type { RayenClinicalEnrichmentRolloutSummary } from '@/types/functionsTelemetry';

const makeSummary = (
  overrides: Partial<RayenClinicalEnrichmentRolloutSummary> = {}
): RayenClinicalEnrichmentRolloutSummary => ({
  parityContractVersion: 2,
  total: 4,
  enforcedWrites: 4,
  failureCount: 0,
  blockedCount: 0,
  permissionDeniedCount: 0,
  evidenceHours: 9,
  cleanWindowRuns: 4,
  cleanEnforcedWrites: 4,
  cleanEvidenceHours: 9,
  recommendation: 'monitor_enforced',
  ...overrides,
});

describe('RayenClinicalEnrichmentRolloutCard', () => {
  it('shows confirmed transactional batch monitoring', () => {
    render(<RayenClinicalEnrichmentRolloutCard summary={makeSummary()} />);

    expect(screen.getByText('Lote clínico transaccional')).toBeInTheDocument();
    expect(screen.getByText('Lote activo en monitoreo')).toBeInTheDocument();
    expect(screen.queryByText('Shadow')).not.toBeInTheDocument();
    expect(screen.getByText('Permisos denegados')).toBeInTheDocument();
    expect(screen.getByText(/contrato v2/i)).toBeInTheDocument();
    expect(screen.getByText(/la racha muestra ejecuciones sin fallos/i)).toBeInTheDocument();
    expect(screen.getAllByText('9')).toHaveLength(2);
  });

  it('surfaces mismatches as blocking evidence', () => {
    render(
      <RayenClinicalEnrichmentRolloutCard
        summary={makeSummary({
          recommendation: 'investigate',
        })}
      />
    );

    expect(screen.getByText('Revisar fallos del lote')).toBeInTheDocument();
  });
});
