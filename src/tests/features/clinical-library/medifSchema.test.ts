import { describe, expect, it } from 'vitest';
import {
  MEDIF_FIELDS,
  MEDIF_FIELD_BY_ID,
  MEDIF_GROUPS,
  MEDIF_SECTIONS,
  getMedifGroupFieldIds,
} from '@/features/clinical-library/domain/medifSchema';
import {
  emptyMedifValues,
  exportMedifDraft,
  importMedifDraft,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';

const draftJson = (values: Record<string, unknown>) => JSON.stringify({ version: 1, values });

describe('MEDIF form contract', () => {
  it('preserves the 137 PDF field names and assigns every widget exactly once', () => {
    expect(MEDIF_FIELDS).toHaveLength(137);
    expect(MEDIF_FIELDS.filter(field => field.kind === 'text')).toHaveLength(69);
    expect(MEDIF_FIELDS.filter(field => field.kind === 'mark')).toHaveLength(68);
    expect(MEDIF_SECTIONS).toHaveLength(10);
    const groupedIds = MEDIF_GROUPS.flatMap(getMedifGroupFieldIds);
    expect(new Set(groupedIds).size).toBe(137);
    expect([...groupedIds].sort()).toEqual(MEDIF_FIELDS.map(field => field.name).sort());
    for (const section of MEDIF_SECTIONS) {
      for (const group of section.groups) {
        for (const id of getMedifGroupFieldIds(group)) {
          expect(MEDIF_FIELD_BY_ID[id]).toMatchObject({
            id,
            name: id,
            sectionId: section.id,
            groupId: group.id,
            kind: group.type === 'choice' ? 'mark' : 'text',
          });
        }
      }
    }
  });

  it('synchronizes patient identity without linking independent medical answers', () => {
    const original = emptyMedifValues();
    const named = setMedifFieldValue(original, 'p1_nombre_pasajero', 'Ana Ñáñez');
    expect(named.p2_nombre_paciente).toBe('Ana Ñáñez');
    const aged = setMedifFieldValue(named, 'p2_edad', '8 meses');
    expect(aged.p1_edad).toBe('8 meses');
    expect(original.p1_nombre_pasajero).toBe('');
    const wheelchair = setMedifFieldValue(aged, 'p1_silla_si', 'X');
    expect(wheelchair.p3_silla_ruedas_si).toBe('');
    expect(wheelchair.p3_silla_ruedas_no).toBe('');
  });

  it('replaces a previous response atomically in every exclusive question', () => {
    for (const group of MEDIF_GROUPS) {
      if (group.type !== 'choice' || group.multiple) continue;
      let values = emptyMedifValues();
      for (const option of group.options) {
        values = setMedifFieldValue(values, option.fieldId, 'X');
        expect(group.options.filter(candidate => values[candidate.fieldId] === 'X')).toEqual([
          option,
        ]);
      }
    }
  });

  it.each(['p2_nombre_medico', 'p1_medico_autorizado', 'p3_medico_declaracion'])(
    'synchronizes and clears all physician names when editing %s',
    id => {
      const original = emptyMedifValues();
      const named = setMedifFieldValue(original, id, 'Dra. Prueba Ñáñez');
      const cleared = setMedifFieldValue(named, id, '');
      for (const fieldId of ['p2_nombre_medico', 'p1_medico_autorizado', 'p3_medico_declaracion']) {
        expect(named[fieldId]).toBe('Dra. Prueba Ñáñez');
        expect(cleared[fieldId]).toBe('');
        expect(original[fieldId]).toBe('');
      }
      expect(importMedifDraft(exportMedifDraft(named))).toEqual(named);
    }
  );

  it('migrates legacy physician names using Datos del médico as the source', () => {
    for (const values of [
      { p2_nombre_medico: 'Dra. Prueba', p1_medico_autorizado: 'Nombre anterior' },
      { p1_medico_autorizado: 'Dra. Prueba' },
      { p3_medico_declaracion: 'Dra. Prueba' },
    ]) {
      const imported = importMedifDraft(draftJson(values));
      expect(imported.p2_nombre_medico).toBe('Dra. Prueba');
      expect(imported.p1_medico_autorizado).toBe('Dra. Prueba');
      expect(imported.p3_medico_declaracion).toBe('Dra. Prueba');
    }
    expect(() =>
      importMedifDraft(
        draftJson({
          p1_medico_autorizado: 'Dra. A',
          p3_medico_declaracion: 'Dr. B',
        })
      )
    ).toThrow(/nombres de médico diferentes/);
  });

  it('fixes the route in initial values, direct changes and imported legacy drafts; shares declaration dates', () => {
    const values = emptyMedifValues();
    expect(values).toMatchObject({
      p1_itinerario_1_desde: 'Isla de Pascua',
      p1_itinerario_1_hacia: 'Santiago',
    });
    expect(
      setMedifFieldValue(values, 'p1_itinerario_1_hacia', 'Otra ciudad').p1_itinerario_1_hacia
    ).toBe('Santiago');
    const imported = importMedifDraft(
      draftJson({
        p1_itinerario_1_desde: 'Otro origen',
        p1_itinerario_1_hacia: 'Otro destino',
        p3_fecha_declaracion: '16/10/2026',
        p1_declaracion_fecha: '01/01/2020',
      })
    );
    expect(imported).toMatchObject({
      p1_itinerario_1_desde: 'Isla de Pascua',
      p1_itinerario_1_hacia: 'Santiago',
      p3_fecha_declaracion: '16/10/2026',
      p1_declaracion_fecha: '16/10/2026',
    });
    expect(
      importMedifDraft(draftJson({ p1_declaracion_fecha: '15/10/2026' })).p3_fecha_declaracion
    ).toBe('15/10/2026');
    expect(setMedifFieldValue(imported, 'p3_fecha_declaracion', '').p1_declaracion_fecha).toBe('');
  });

  it('round-trips a draft and rejects unknown fields, invalid marks and conflicting responses', () => {
    const values = setMedifFieldValue(emptyMedifValues(), 'p1_nombre_pasajero', 'Ana Ñáñez');
    expect(importMedifDraft(exportMedifDraft(values))).toEqual(values);
    expect(() => importMedifDraft(draftJson({ unexpected: 'patient' }))).toThrow(/desconocidos/);
    expect(() => importMedifDraft(draftJson({ p1_edad: 20 }))).toThrow(/texto/);
    expect(() => importMedifDraft(draftJson({ p1_silla_si: 'yes' }))).toThrow(/solo admiten X/);
    expect(() => importMedifDraft(draftJson({ p1_silla_si: 'X', p1_silla_no: 'X' }))).toThrow(
      /incompatibles/
    );
    expect(() => importMedifDraft(draftJson({ p1_nombre_pasajero: 'Ana' }))).toThrow(
      /no coinciden/
    );
    expect(() => importMedifDraft('{')).toThrow(/JSON/);
    expect(() => importMedifDraft(JSON.stringify({ version: 2, values: {} }))).toThrow(/versión 1/);
    expect(() =>
      importMedifDraft(JSON.stringify({ version: 1, values: {}, patient: 'Ana' }))
    ).toThrow(/únicamente/);
  });
});
