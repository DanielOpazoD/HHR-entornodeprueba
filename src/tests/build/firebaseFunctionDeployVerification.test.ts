import { describe, expect, it } from 'vitest';
import {
  collectDeployedFunctionNames,
  findMissingFirebaseFunctions,
} from '../../../scripts/check-deployed-firebase-functions.mjs';

describe('Firebase function deployment verification', () => {
  it('recognizes exact endpoint ids from the Firebase CLI result', () => {
    const payload = {
      status: 'success',
      result: [{ id: 'applyRayenClinicalEnrichmentBatch' }, { id: 'otherFunction' }],
    };

    expect(collectDeployedFunctionNames(payload)).toEqual(
      new Set(['applyRayenClinicalEnrichmentBatch', 'otherFunction'])
    );
    expect(findMissingFirebaseFunctions(payload, ['applyRayenClinicalEnrichmentBatch'])).toEqual(
      []
    );
  });

  it('fails closed when the clinical fast path is absent', () => {
    expect(
      findMissingFirebaseFunctions(
        { status: 'success', result: [{ id: 'saveDailyRecordWithClinicalAuthority' }] },
        ['applyRayenClinicalEnrichmentBatch']
      )
    ).toEqual(['applyRayenClinicalEnrichmentBatch']);
  });

  it('does not accept a matching handler name or prefixed endpoint id', () => {
    const required = ['applyRayenClinicalEnrichmentBatch'];

    expect(
      findMissingFirebaseFunctions(
        {
          status: 'success',
          result: [
            { id: 'legacyWrapper', entryPoint: 'applyRayenClinicalEnrichmentBatch' },
            { id: 'staging-applyRayenClinicalEnrichmentBatch' },
          ],
        },
        required
      )
    ).toEqual(required);
  });

  it('fails closed for an unexpected Firebase CLI payload shape', () => {
    expect(
      findMissingFirebaseFunctions(
        { status: 'success', functions: [{ id: 'applyRayenClinicalEnrichmentBatch' }] },
        ['applyRayenClinicalEnrichmentBatch']
      )
    ).toEqual(['applyRayenClinicalEnrichmentBatch']);
  });
});
