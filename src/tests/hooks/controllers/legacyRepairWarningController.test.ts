// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasCriticalLegacyRepairSignal } from '@/hooks/controllers/legacyRepairWarningController';

describe('legacyRepairWarningController', () => {
  it('ignores minor legacy normalization rules', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        compatibilityIntensity: 'moderate',
        migrationRulesApplied: ['legacy_nulls_normalized', 'schema_defaults_applied'],
      })
    ).toBe(false);
  });

  it('flags critical fallback repair rules', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        compatibilityIntensity: 'high',
        migrationRulesApplied: ['salvage_patient_fallback_applied'],
      })
    ).toBe(true);
  });

  it('detects critical source compatibility repairs', () => {
    expect(
      hasCriticalLegacyRepairSignal({
        sourceCompatibilityIntensity: 'high',
        sourceMigrationRulesApplied: ['salvage_patient_fallback_applied'],
      })
    ).toBe(true);
  });
});
