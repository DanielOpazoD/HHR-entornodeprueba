import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {
  applicationFrom,
  patientForEncounter,
  templateFrom,
} = require('../../../functions/lib/checklists/model.js');
const { templates } = require('../../../functions/lib/checklists/templates.js');

describe('pautas clínicas', () => {
  it('mantiene el cumplimiento del instrumento oficial y exige la justificación condicional', () => {
    const template = templateFrom(templates[1]);
    const answers = {
      servicio: 'Prueba',
      fecha: '2026-11-24',
      hora: '01:18',
      profesional: 'Rol de prueba',
      numero: '1',
      criterio: template.fields[5].options[0].label,
      excede: 'Sí',
      cumple: 'No',
    };
    expect(() => applicationFrom(template, answers)).toThrow('Justificación');
    expect(() => applicationFrom(template, { ...answers, excede: ' Sí ' })).toThrow(
      'Justificación'
    );
    expect(
      applicationFrom(template, { ...answers, justificacion: 'Ejemplo sintético' }).score
    ).toBeNull();
    expect(() => applicationFrom(template, { ...answers, fecha: '2026-02-31' })).toThrow('Fecha');
  });
  it('calcula solo los puntos configurados y excluye los campos opcionales sin responder', () => {
    const field = {
      id: 'uno',
      type: 'choice',
      label: 'Ítem',
      required: true,
      options: [
        { label: 'A', points: 0 },
        { label: 'B', points: 3 },
      ],
    };
    const template = templateFrom({
      id: 'test',
      title: 'Prueba',
      fields: [field, { ...field, id: 'dos', required: false }],
    });
    expect(applicationFrom(template, { uno: 'A' }).score).toEqual({ points: 0, maximum: 3 });
    expect(() => applicationFrom(template, { uno: 'Otra' })).toThrow();
    expect(() =>
      templateFrom({
        ...template,
        fields: [{ ...field, options: [field.options[0], { label: 'B' }] }],
      })
    ).toThrow();
  });
  it('contrasta documento y episodio de forma independiente, incluidas cunas y pasaportes', () => {
    const person = {
      clinicalEpisodeId: '601',
      documentType: 'Pasaporte',
      rut: 'TEST-19X',
      patientName: 'Ejemplo ficticio',
    };
    expect(
      patientForEncounter({ beds: { A: { clinicalCrib: person } } }, '601', 'test-19x').name
    ).toBe(person.patientName);
    expect(() =>
      patientForEncounter({ beds: { A: person, B: person } }, '601', person.rut)
    ).toThrow();
    expect(() => patientForEncounter({ beds: { A: person } }, '601', 'TEST19X')).toThrow();
    expect(() => patientForEncounter({ beds: { A: person } }, '602', person.rut)).toThrow();
  });
});
