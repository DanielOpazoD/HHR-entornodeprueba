import { describe, expect, it } from 'vitest';
import {
  MEDIF_DUPLICATE_FIELD_IDS,
  MEDIF_FORM_BLOCKS,
  getMedifCanonicalFieldId,
  getMedifFormBlockGroups,
  getMedifFormBlockIdForField,
  getMedifFormGroupLabel,
} from '@/features/clinical-library/domain/medifFormLayout';
import {
  MEDIF_FIELDS,
  MEDIF_GROUPS,
  getMedifGroupFieldIds,
} from '@/features/clinical-library/domain/medifSchema';

describe('continuous MEDIF form layout', () => {
  it('places every PDF group and field exactly once across the seven functional blocks', () => {
    const groups = MEDIF_FORM_BLOCKS.flatMap(getMedifFormBlockGroups);
    expect(MEDIF_FORM_BLOCKS).toHaveLength(7);
    expect(groups).toHaveLength(MEDIF_GROUPS.length);
    expect(new Set(groups.map(group => group.id)).size).toBe(MEDIF_GROUPS.length);
    expect(groups.map(group => group.id).sort()).toEqual(
      MEDIF_GROUPS.map(group => group.id).sort()
    );
    const fields = groups.flatMap(getMedifGroupFieldIds);
    expect(new Set(fields).size).toBe(137);
    expect(fields.sort()).toEqual(MEDIF_FIELDS.map(field => field.id).sort());
  });

  it('deduplicates patient identity and all three physician names', () => {
    expect(MEDIF_DUPLICATE_FIELD_IDS).toEqual([
      'p2_nombre_paciente',
      'p2_edad',
      'p1_medico_autorizado',
      'p3_medico_declaracion',
    ]);
    expect(getMedifCanonicalFieldId('p2_nombre_paciente')).toBe('p1_nombre_pasajero');
    expect(getMedifCanonicalFieldId('p2_edad')).toBe('p1_edad');
    for (const field of MEDIF_FIELDS) {
      if (!MEDIF_DUPLICATE_FIELD_IDS.includes(field.id)) {
        expect(getMedifCanonicalFieldId(field.id)).toBe(field.id);
      }
    }
    expect(getMedifCanonicalFieldId('p3_silla_ruedas_si')).toBe('p3_silla_ruedas_si');
    expect(getMedifCanonicalFieldId('p1_medico_autorizado')).toBe('p2_nombre_medico');
    expect(getMedifCanonicalFieldId('p3_medico_declaracion')).toBe('p2_nombre_medico');
  });

  it('routes dictionary links to the canonical block and keeps wheelchair declarations distinct', () => {
    expect(getMedifFormBlockIdForField('p2_nombre_paciente')).toBe('paciente_vuelo');
    expect(getMedifFormBlockIdForField('p2_diagnostico_actual')).toBe('diagnostico_evaluacion');
    expect(getMedifFormBlockIdForField('p3_firma_medico_texto')).toBe('medico_declaraciones');
    expect(getMedifFormBlockIdForField('unknown')).toBeUndefined();
    const passenger = MEDIF_GROUPS.find(group => group.id === 'silla_pasajero')!;
    const physician = MEDIF_GROUPS.find(group => group.id === 'silla_medico')!;
    expect(getMedifFormGroupLabel(passenger)).toContain('Declaración del pasajero');
    expect(getMedifFormGroupLabel(physician)).toContain('Evaluación del médico');
    expect(getMedifGroupFieldIds(passenger)).not.toEqual(getMedifGroupFieldIds(physician));
  });
});
