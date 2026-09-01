import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildUpdatePatientPatches,
  filterUnchangedBedFieldPatches,
} from '@/hooks/controllers/bedManagementPatchController';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { Specialty } from '@/types/domain/patientClassification';

/**
 * Contrato de diff del guardado de paciente (Fase 2): los guardados del censo
 * reenvían el objeto completo, y cada campo presente-pero-idéntico engordaba
 * la escritura y disparaba side-effects «por presencia». El parche final debe
 * contener SOLO lo que cambia, sin romper el contrato de acompañamiento del
 * servidor (bedTypeOverrides viaja con un parche UPC de la misma cama).
 */
describe('parches por diff del guardado de paciente', () => {
  const makeRecordWithPatient = (overrides: Record<string, unknown> = {}) => {
    const record = DataFactory.createMockDailyRecord('2026-04-20');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      pathology: 'Neumonia',
      specialty: Specialty.MEDICINA,
      ...overrides,
    });
    return record;
  };

  it('un reenvío completo con un solo cambio real emite solo ese campo', () => {
    const record = makeRecordWithPatient();
    const current = record.beds.R1;

    const patch = buildUpdatePatientPatches(record, 'R1', {
      patientName: current.patientName,
      rut: current.rut,
      pathology: current.pathology,
      specialty: current.specialty,
      age: '46',
    });

    expect(Object.keys(patch)).toEqual(['beds.R1.age']);
  });

  it('un objeto reenviado deep-igual (otra referencia) también se poda', () => {
    const checklist = {
      uciCriteria: ['uci_vmi'],
      utiCriteria: [],
      classification: 'UPC_UCI',
      evaluatedAt: '2026-04-20T00:00:00Z',
    };
    const record = makeRecordWithPatient({ isUPC: true, upcChecklist: checklist });

    const patch = buildUpdatePatientPatches(record, 'R1', {
      isUPC: true,
      upcChecklist: JSON.parse(JSON.stringify(checklist)),
    });

    expect(patch).toEqual({});
  });

  it('los clears de ginecobstetricia «por presencia» no se emiten si ya no hay nada que borrar', () => {
    const record = makeRecordWithPatient();

    const patch = buildUpdatePatientPatches(record, 'R1', {
      specialty: record.beds.R1.specialty,
    });

    expect(patch).toEqual({});
  });

  it('los clears sí fluyen cuando reparan deriva real (campo gineco huérfano)', () => {
    const record = makeRecordWithPatient({ deliveryRoute: 'Cesárea' });

    const patch = buildUpdatePatientPatches(record, 'R1', {
      specialty: record.beds.R1.specialty,
    });

    expect(patch).toMatchObject({ 'beds.R1.deliveryRoute': undefined });
  });

  it('si bedTypeOverrides sobrevive al diff, re-ancla isUPC como acompañante del sobre clínico', () => {
    const record = makeRecordWithPatient({ isUPC: true });

    const filtered = filterUnchangedBedFieldPatches(record, 'R1', {
      'bedTypeOverrides.R1': 'UCI',
      'beds.R1.isUPC': true,
    });

    // isUPC no cambió (se podaría), pero el override huérfano sería rechazado
    // por el servidor («must accompany a UPC patch»): el guard lo re-ancla.
    expect(filtered).toEqual({
      'bedTypeOverrides.R1': 'UCI',
      'beds.R1.isUPC': true,
    });
  });

  it('un bedTypeOverrides sin cambio real se poda junto con su acompañante', () => {
    const record = makeRecordWithPatient({ isUPC: true });
    record.bedTypeOverrides = { R1: 'UCI' } as typeof record.bedTypeOverrides;

    const filtered = filterUnchangedBedFieldPatches(record, 'R1', {
      'bedTypeOverrides.R1': 'UCI',
      'beds.R1.isUPC': true,
    });

    expect(filtered).toEqual({});
  });
});

describe('arePatchValuesDeepEqual · semántica de parche', () => {
  it('trata undefined y clave ausente como equivalentes', () => {
    expect(arePatchValuesDeepEqual({ a: undefined }, {})).toBe(true);
    expect(arePatchValuesDeepEqual(undefined, undefined)).toBe(true);
    expect(arePatchValuesDeepEqual(undefined, null)).toBe(false);
    expect(arePatchValuesDeepEqual(undefined, '')).toBe(false);
  });

  it('compara arreglos y objetos anidados por contenido y orden', () => {
    expect(arePatchValuesDeepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    expect(arePatchValuesDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(arePatchValuesDeepEqual({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
    expect(arePatchValuesDeepEqual({ a: { b: [1] } }, { a: { b: [1, 2] } })).toBe(false);
  });
});
