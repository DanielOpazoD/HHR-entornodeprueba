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
