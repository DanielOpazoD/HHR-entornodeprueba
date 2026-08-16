import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RayenClinicalEnrichmentRolloutCard } from '@/features/admin/components/internal/functionsTelemetry/RayenClinicalEnrichmentRolloutCard';
import type { RayenClinicalEnrichmentRolloutSummary } from '@/types/functionsTelemetry';

const makeSummary = (
  overrides: Partial<RayenClinicalEnrichmentRolloutSummary> = {}
): RayenClinicalEnrichmentRolloutSummary => ({
  parityContractVersion: 2,
  total: 4,
  shadowRuns: 4,
  enforcedWrites: 0,
  matchedShadowRuns: 4,
  mismatchedShadowRuns: 0,
  unavailableShadowRuns: 0,
  failureCount: 0,
  blockedCount: 0,
  permissionDeniedCount: 0,
  evidenceHours: 9,
  cleanWindowRuns: 4,
  cleanMatchedShadowRuns: 4,
  cleanEnforcedWrites: 0,
  cleanEvidenceHours: 9,
  recommendation: 'ready_for_enforced',
  ...overrides,
});

describe('RayenClinicalEnrichmentRolloutCard', () => {
  it('shows when the transactional batch has enough safe shadow evidence', () => {
    render(<RayenClinicalEnrichmentRolloutCard summary={makeSummary()} />);

    expect(screen.getByText('Lote clínico transaccional')).toBeInTheDocument();
    expect(screen.getByText('Listo para activar el lote')).toBeInTheDocument();
    expect(screen.getByText('Paridad OK')).toBeInTheDocument();
    expect(screen.getByText('Permisos denegados')).toBeInTheDocument();
    expect(screen.getByText(/contrato v2/i)).toBeInTheDocument();
    expect(screen.getByText(/la racha limpia decide el gate/i)).toBeInTheDocument();
    expect(screen.getAllByText('9')).toHaveLength(2);
  });

  it('surfaces mismatches as blocking evidence', () => {
    render(
      <RayenClinicalEnrichmentRolloutCard
        summary={makeSummary({
          matchedShadowRuns: 3,
          mismatchedShadowRuns: 1,
          recommendation: 'investigate',
        })}
      />
    );

    expect(screen.getByText('Investigar antes de activar')).toBeInTheDocument();
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
  });
});
