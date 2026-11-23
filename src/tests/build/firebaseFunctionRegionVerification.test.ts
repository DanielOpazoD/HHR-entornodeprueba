// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectDeployedFunctionLocations,
  evaluateFirebaseFunctionRegions,
} from '../../../scripts/check-firebase-function-regions.mjs';

const SAVE = 'saveDailyRecordWithClinicalAuthority';
const PATCH = 'patchDailyRecordWithClinicalAuthority';

describe('Firebase function region verification', () => {
  it('reconoce pares exactos id@region de la salida del CLI', () => {
    const payload = {
      status: 'success',
      result: [
        { id: SAVE, region: 'southamerica-east1' },
        { id: SAVE, region: 'us-central1' },
        { id: 'checkUserRole', region: 'us-central1' },
      ],
    };

    expect(collectDeployedFunctionLocations(payload)).toEqual(
      new Set([`${SAVE}@southamerica-east1`, `${SAVE}@us-central1`, 'checkUserRole@us-central1'])
    );
  });

  it('detecta una copia retirada que sigue desplegada aunque el borrado haya reportado éxito', () => {
    // functions:delete puede salir con exit 0 y un borrado fallido en el reporte:
    // la evidencia real es que la copia siga listada después del deploy.
    const payload = {
      status: 'success',
      result: [
        { id: SAVE, region: 'southamerica-east1' },
        { id: PATCH, region: 'southamerica-east1' },
        { id: PATCH, region: 'us-central1' },
      ],
    };

    expect(
      evaluateFirebaseFunctionRegions(
        payload,
        [`${SAVE}@southamerica-east1`, `${PATCH}@southamerica-east1`],
        [`${SAVE}@us-central1`, `${PATCH}@us-central1`]
      )
    ).toEqual({ invalid: [], missing: [], lingering: [`${PATCH}@us-central1`] });
  });

  it('exige que las copias supervivientes de la región del cliente sigan presentes', () => {
    const payload = { status: 'success', result: [{ id: PATCH, region: 'southamerica-east1' }] };

    expect(evaluateFirebaseFunctionRegions(payload, [`${SAVE}@southamerica-east1`], [])).toEqual({
      invalid: [],
      missing: [`${SAVE}@southamerica-east1`],
      lingering: [],
    });
  });

  it('no acepta coincidencias por prefijo, entryPoint ni región parcial', () => {
    const payload = {
      status: 'success',
      result: [
        { id: `staging-${SAVE}`, region: 'southamerica-east1' },
        { id: 'wrapper', entryPoint: SAVE, region: 'southamerica-east1' },
        { id: SAVE, region: 'southamerica-east1-b' },
      ],
    };

    expect(evaluateFirebaseFunctionRegions(payload, [`${SAVE}@southamerica-east1`], [])).toEqual({
      invalid: [],
      missing: [`${SAVE}@southamerica-east1`],
      lingering: [],
    });
  });

  it('falla cerrado ante un payload con forma inesperada o specs malformados', () => {
    expect(
      evaluateFirebaseFunctionRegions(
        { status: 'success', functions: [{ id: SAVE, region: 'southamerica-east1' }] },
        [`${SAVE}@southamerica-east1`],
        []
      )
    ).toEqual({ invalid: [], missing: [`${SAVE}@southamerica-east1`], lingering: [] });

    expect(
      evaluateFirebaseFunctionRegions({ status: 'success', result: [] }, [SAVE, '@x', 'y@'], [])
        .invalid
    ).toEqual([SAVE, '@x', 'y@']);
  });
});

describe('clinical callable regional rollout', () => {
  const BATCH_NAME = 'applyRayenClinicalEnrichmentBatch';

  it('declares both endpoints with the real Firebase SDK, retaining old clients', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      const { createRayenClinicalEnrichmentFunctions } = require('./functions/lib/rayenClinicalEnrichmentFunctions');
      const callable = createRayenClinicalEnrichmentFunctions({}).${BATCH_NAME};
      console.log(JSON.stringify(callable.__endpoint));
    `,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    const endpoint = JSON.parse(output);
    expect(endpoint.region).toEqual(['us-central1', 'southamerica-east1']);
    // At the default 256 MB this batch took about 11 s on a cold instance; its siblings use 1 GB.
    expect(endpoint.availableMemoryMb).toBe(1024);
  });

  it('fails deployment verification if either compatibility or destination endpoint is absent', () => {
    const workflow = readFileSync('.github/workflows/deploy-functions.yml', 'utf8');
    const required = [`${BATCH_NAME}@southamerica-east1`, `${BATCH_NAME}@us-central1`];
    required.forEach(spec => expect(workflow).toContain(spec));
    for (const region of ['southamerica-east1', 'us-central1']) {
      expect(
        evaluateFirebaseFunctionRegions({ result: [{ id: BATCH_NAME, region }] }, required, [])
          .missing
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
