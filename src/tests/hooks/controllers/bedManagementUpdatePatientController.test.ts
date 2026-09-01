import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUpdatePatientActionPatch } from '@/hooks/controllers/bedManagementUpdatePatientController';

describe('bedManagementUpdatePatientController', () => {
  it('clears cie10 fields when pathology changes through a single-field update', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-19');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      pathology: 'Neumonia',
      cie10Code: 'J18',
      cie10Description: 'Neumonia no especificada',
    });

    const patch = buildUpdatePatientActionPatch(record, {
      bedId: 'R1',
      field: 'pathology',
      value: 'Bronquitis',
    });

    expect(patch).toMatchObject({
      'beds.R1.pathology': 'Bronquitis',
      'beds.R1.cie10Code': undefined,
      'beds.R1.cie10Description': undefined,
    });
  });

  it('emite un parche VACÍO cuando la patología no cambia (CIE-10 intacto, nada que escribir)', () => {
    // Contrato de diff (Fase 2): un valor presente-pero-idéntico no se reemite,
    // así que tampoco existe escritura que pudiera arrastrar side-effects.
    const record = DataFactory.createMockDailyRecord('2026-04-19');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      pathology: 'Neumonia',
      cie10Code: 'J18',
      cie10Description: 'Neumonia no especificada',
    });

    const patch = buildUpdatePatientActionPatch(record, {
      bedId: 'R1',
      field: 'pathology',
      value: 'Neumonia',
    });

    expect(patch).toEqual({});
  });
});
