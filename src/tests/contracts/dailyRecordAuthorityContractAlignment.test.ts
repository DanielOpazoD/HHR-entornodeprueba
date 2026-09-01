/**
 * Test de alineación del CONTRATO ÚNICO de autoridad clínico/estructural.
 *
 * Cada bug de la semana del 31-08 (#282–#290) fue un desacuerdo entre dos
 * capas clasificando la misma ruta de forma distinta: lista del censo,
 * splitter del dispatch, clasificador de rutas, aplanador, functions y
 * reglas. Este test fija que TODAS las capas consumen o igualan el contrato:
 * si alguien agrega un campo clínico o cambia una regla de rutas en una sola
 * capa, esto falla antes de llegar a producción.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  CLINICAL_AUTHORITY_BED_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
  isBedTypeOverridePath,
  isClinicalAuthorityBedScalarPath,
  isClinicalAuthorityCallablePatchPath,
} from '@/services/storage/dailyRecordAuthorityContract';
import { CLINICAL_CENSUS_EDITABLE_FIELDS } from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const require = createRequire(import.meta.url);
const serverContract = require('../../../functions/lib/dailyRecordAuthorityContract.js');
const serverPreservation = require('../../../functions/lib/dailyRecordClinicalFieldPreservation.js');

describe('contrato único de autoridad · alineación entre capas', () => {
  it('cliente y servidor cargan EXACTAMENTE el mismo módulo de contrato', () => {
    expect([...CLINICAL_AUTHORITY_BED_FIELDS]).toEqual([
      ...serverContract.CLINICAL_AUTHORITY_BED_FIELDS,
    ]);
    expect([...RAYEN_CLINICAL_FIELDS]).toEqual([...serverContract.RAYEN_CLINICAL_FIELDS]);
    expect([...SERVER_ONLY_CLINICAL_PATCH_FIELDS]).toEqual([
      ...serverContract.SERVER_ONLY_CLINICAL_PATCH_FIELDS,
    ]);
  });

  it('las listas históricas del cliente igualan el contrato (censo y campos Rayen)', () => {
    expect([...CLINICAL_CENSUS_EDITABLE_FIELDS]).toEqual([...CLINICAL_AUTHORITY_BED_FIELDS]);
    // RAYEN_OWNED_CLINICAL_FIELDS conserva su literal por el tipado
    // `satisfies keyof PatientData`; este pin impide su deriva.
    expect([...RAYEN_OWNED_CLINICAL_FIELDS]).toEqual([...RAYEN_CLINICAL_FIELDS]);
  });

  it('la preservación del servidor consume el contrato (dispositivos vs lote)', () => {
    expect([...serverPreservation.RAYEN_CLINICAL_FIELDS]).toEqual([...RAYEN_CLINICAL_FIELDS]);
    expect([...serverPreservation.RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS]).toEqual([
      ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
    ]);
    expect([...serverPreservation.RAYEN_BATCH_ONLY_CLINICAL_FIELDS]).toEqual([
      ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
    ]);
  });

  it('los conjuntos del lote no se solapan y su unión conserva el orden estable', () => {
    const batchOnly = new Set<string>(RAYEN_BATCH_ONLY_CLINICAL_FIELDS);
    const solape = RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS.filter(field => batchOnly.has(field));
    expect(solape).toEqual([]);
    expect([...RAYEN_CLINICAL_FIELDS]).toEqual([
      ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
      ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
    ]);
  });

  it('matriz de clasificación de rutas: cada forma se clasifica igual en todas las capas', () => {
    const casos: Array<{ ruta: string; escalarClinico: boolean; override: boolean }> = [
      // sobre clínico
      { ruta: 'beds.R1.pathology', escalarClinico: true, override: false },
      { ruta: 'beds.R1.upcChecklist', escalarClinico: true, override: false },
      { ruta: 'beds.R1.isUPC', escalarClinico: true, override: false },
      { ruta: 'bedTypeOverrides.R1', escalarClinico: false, override: true },
      // estructural / identidad
      { ruta: 'beds.R1.patientName', escalarClinico: false, override: false },
      { ruta: 'beds.R1.rut', escalarClinico: false, override: false },
      // dispositivos: Rayen+manual, NO son sobre clínico del censo
      { ruta: 'beds.R1.devices', escalarClinico: false, override: false },
      { ruta: 'beds.R1.deviceDetails', escalarClinico: false, override: false },
      // profundidades que NUNCA clasifican (la regla exige exactamente 3/2)
      { ruta: 'beds.R1.upcChecklist.classification', escalarClinico: false, override: false },
      { ruta: 'bedTypeOverrides.R1.extra', escalarClinico: false, override: false },
      { ruta: 'beds.R1', escalarClinico: false, override: false },
      { ruta: 'dateTimestamp', escalarClinico: false, override: false },
    ];

    for (const caso of casos) {
      expect({
        ruta: caso.ruta,
        cliente: {
          escalar: isClinicalAuthorityBedScalarPath(caso.ruta),
          override: isBedTypeOverridePath(caso.ruta),
          sobre: isClinicalAuthorityCallablePatchPath(caso.ruta),
        },
        servidor: {
          escalar: serverContract.isClinicalAuthorityBedScalarPath(caso.ruta),
          override: serverContract.isBedTypeOverridePath(caso.ruta),
          sobre: serverContract.isClinicalAuthorityCallablePatchPath(caso.ruta),
        },
      }).toEqual({
        ruta: caso.ruta,
        cliente: {
          escalar: caso.escalarClinico,
          override: caso.override,
          sobre: caso.escalarClinico || caso.override,
        },
        servidor: {
          escalar: caso.escalarClinico,
          override: caso.override,
          sobre: caso.escalarClinico || caso.override,
        },
      });
    }
  });
});
