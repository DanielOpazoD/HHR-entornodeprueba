import { describe, expect, it } from 'vitest';
import { stripInheritedAuthorityRepair } from '@/services/storage/firestore/firestoreInheritedRepairSeparation';

const MIXED_PATCH = {
  'beds.R1.patientName': 'Ana Patricia Gomez Prueba',
  'beds.R1.firstName': 'Ana Patricia',
  // Divergencia local heredada de un parche mixto antiguo (bug ya corregido):
  'beds.R1.pathology': '',
  dateTimestamp: 1234,
};

describe('stripInheritedAuthorityRepair', () => {
  it('poda la reparación clínica heredada cuando la intención es estructural', () => {
    // Caso real (31-08): pathology:'' envenenado bloqueaba TODA escritura del
    // registro con «mezcla campos clínicos y estructurales» — incluida la
    // reparación misma, así que nunca sanaba.
    const stripped = stripInheritedAuthorityRepair(MIXED_PATCH, [
      'beds.R1.patientName',
      'beds.R1.firstName',
    ]);

    expect(Object.keys(stripped).sort()).toEqual([
      'beds.R1.firstName',
      'beds.R1.patientName',
      'dateTimestamp',
    ]);
  });

  it('poda la reparación estructural heredada cuando la intención es clínica', () => {
    const stripped = stripInheritedAuthorityRepair(
      {
        'beds.R1.pathology': 'Bradicardia, no especificada',
        'beds.R1.firstName': 'Divergencia Heredada',
        dateTimestamp: 1234,
      },
      ['beds.R1.pathology']
    );

    expect(Object.keys(stripped).sort()).toEqual(['beds.R1.pathology', 'dateTimestamp']);
  });

  it('nunca poda una ruta pedida explícitamente aunque cruce autoridades', () => {
    // Intención mixta explícita → sin poda: mandan los rechazos fail-closed.
    expect(
      stripInheritedAuthorityRepair(MIXED_PATCH, ['beds.R1.patientName', 'beds.R1.pathology'])
    ).toBe(MIXED_PATCH);
  });

  it('sin contrato semántico o sin mezcla real devuelve el parche intacto', () => {
    expect(stripInheritedAuthorityRepair(MIXED_PATCH, undefined)).toBe(MIXED_PATCH);
    expect(stripInheritedAuthorityRepair(MIXED_PATCH, [])).toBe(MIXED_PATCH);
    const structuralOnly = { 'beds.R1.patientName': 'Ana' };
    expect(stripInheritedAuthorityRepair(structuralOnly, ['beds.R1.patientName'])).toBe(
      structuralOnly
    );
    const clinicalOnly = { 'beds.R1.pathology': 'Bradicardia' };
    expect(stripInheritedAuthorityRepair(clinicalOnly, ['beds.R1.pathology'])).toBe(clinicalOnly);
  });

  it('una intención semántica fuera del árbol de camas no habilita poda', () => {
    // rayenSync/handoff u otros campos no-cama no son «estructural de cama»:
    // ante mezcla con clínico heredado, se conserva el fail-closed existente.
    expect(
      stripInheritedAuthorityRepair({ handoffNovedadesDayShift: 'Nota', 'beds.R1.pathology': '' }, [
        'handoffNovedadesDayShift',
      ])
    ).toEqual({ handoffNovedadesDayShift: 'Nota', 'beds.R1.pathology': '' });
  });
});
