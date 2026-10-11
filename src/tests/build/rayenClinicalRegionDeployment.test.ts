import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateFirebaseFunctionRegions } from '../../../scripts/check-firebase-function-regions.mjs';

const NAME = 'applyRayenClinicalEnrichmentBatch';

describe('clinical callable regional rollout', () => {
  it('declares both endpoints with the real Firebase SDK, retaining old clients', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      const { createRayenClinicalEnrichmentFunctions } = require('./functions/lib/rayenClinicalEnrichmentFunctions');
      const callable = createRayenClinicalEnrichmentFunctions({}).${NAME};
      console.log(JSON.stringify(callable.__endpoint.region));
    `,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    expect(JSON.parse(output)).toEqual(['us-central1', 'southamerica-east1']);
  });

  it('fails deployment verification if either compatibility or destination endpoint is absent', () => {
    const workflow = readFileSync('.github/workflows/deploy-functions.yml', 'utf8');
    const required = [`${NAME}@southamerica-east1`, `${NAME}@us-central1`];
    required.forEach(spec => expect(workflow).toContain(spec));
    for (const region of ['southamerica-east1', 'us-central1']) {
      expect(
        evaluateFirebaseFunctionRegions({ result: [{ id: NAME, region }] }, required, []).missing
      ).toHaveLength(1);
    }
    expect(
      evaluateFirebaseFunctionRegions(
        {
          result: required.map(spec => {
            const [id, region] = spec.split('@');
            return { id, region };
          }),
        },
        required,
        []
      ).missing
    ).toEqual([]);
  });
});
