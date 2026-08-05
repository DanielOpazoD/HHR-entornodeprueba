import { describe, expect, it } from 'vitest';
import {
  assessEndToEndRuntimeContract,
  getEndToEndRuntimeContractSnapshot,
} from '@/services/repositories/runtimeContractGovernance';

describe('runtimeContractGovernance', () => {
  it('builds a complete end-to-end snapshot', () => {
    const snapshot = getEndToEndRuntimeContractSnapshot();

    expect(snapshot.clientRuntimeContractVersion).toBeGreaterThan(0);
    expect(snapshot.backendRuntimeContractVersion).toBeGreaterThan(0);
    expect(snapshot.minSupportedClientRuntimeContractVersion).toBeGreaterThan(0);
    expect(snapshot.minSupportedClientRuntimeContractVersion).toBeLessThanOrEqual(
      snapshot.clientRuntimeContractVersion
    );
    expect(snapshot.minSupportedClientRuntimeContractVersion).toBe(1);
    expect(snapshot.minSupportedBackendRuntimeContractVersion).toBeLessThanOrEqual(
      snapshot.backendRuntimeContractVersion
    );
    expect(snapshot.backendSupportedSchemaVersion).toBe(snapshot.currentSchemaVersion);
    expect(snapshot.backendLegacySchemaFloorVersion).toBe(snapshot.legacySchemaVersion);
    expect(snapshot.schemaGovernance.ok).toBe(true);
    expect(snapshot.schemaEvolution.currentVersion).toBe(snapshot.currentSchemaVersion);
  });

  it('assesses the current runtime contract as compatible', () => {
    const assessment = assessEndToEndRuntimeContract();

    expect(assessment.ok).toBe(true);
    expect(assessment.reason).toBe('compatible');
  });
});
