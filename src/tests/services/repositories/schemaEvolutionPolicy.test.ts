// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { assessSchemaCompatibility } from '@/services/repositories/schemaEvolutionPolicy';

describe('schemaEvolutionPolicy', () => {
  it('marks missing versions as legacy bridge candidates', () => {
    const assessment = assessSchemaCompatibility({});
    expect(assessment.disposition).toBe('legacy_bridge');
    expect(assessment.requiresMigration).toBe(true);
    expect(assessment.legacyBridgeCandidate).toBe(true);
  });

  it('marks current records as current', () => {
    const assessment = assessSchemaCompatibility({ schemaVersion: 1 });
    expect(assessment.disposition).toBe('current');
    expect(assessment.requiresMigration).toBe(false);
  });

  it('marks ahead-of-runtime records as forward incompatible', () => {
    const assessment = assessSchemaCompatibility({ schemaVersion: 2 });
    expect(assessment.disposition).toBe('forward_incompatible');
    expect(assessment.aheadOfRuntime).toBe(true);
  });
});
