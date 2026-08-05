import { describe, expect, it } from 'vitest';
import {
  assessRuntimeCompatibility,
  getRuntimeCompatibilitySnapshot,
} from '@/services/repositories/runtimeCompatibilityPolicy';

describe('runtimeCompatibilityPolicy', () => {
  it('exposes a stable runtime compatibility snapshot', () => {
    const snapshot = getRuntimeCompatibilitySnapshot();
    expect(snapshot).toMatchObject({
      clientRuntimeContractVersion: 2,
      backendRuntimeContractVersion: 2,
      minSupportedBackendRuntimeContractVersion: 2,
      minSupportedClientRuntimeContractVersion: 1,
    });
    expect(snapshot.currentSchemaVersion).toBeGreaterThanOrEqual(snapshot.legacySchemaVersion);
  });

  it('assesses the current runtime as compatible', () => {
    const assessment = assessRuntimeCompatibility();
    expect(assessment.ok).toBe(true);
    expect(assessment.reason).toBe('compatible');
  });
});
