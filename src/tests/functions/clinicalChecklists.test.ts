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
    ).toThrow(/más de un registro/);
    expect(() => patientForEncounter({ beds: { A: person } }, '601', 'TEST19X')).toThrow(
      /único paciente/
    );
    expect(() => patientForEncounter({ beds: { A: person } }, '602', person.rut)).toThrow(
      /no figura en el censo vigente/
    );
  });

  it('usa el día censal previo solo cuando aún no existe el censo de hoy y ordena las plantillas', async () => {
    const {
      createChecklistHandler,
    } = require('../../../functions/lib/checklists/checklistFunctions.js');
    const docs = new Map<string, Record<string, unknown>>([
      [
        'dailyRecords/2026-11-18',
        {
          beds: {
            H1C1: {
              clinicalEpisodeId: '66009',
              documentType: 'RUT',
              rut: '12.345.678-5',
              patientName: 'Paciente Sintético',
            },
          },
        },
      ],
    ]);
    const makeDocRef = (path: string) => ({
      path,
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    });
    const makeCollection = (name: string) => ({
      doc: (id: string) => makeDocRef(`${name}/${id}`),
      get: async () => ({
        forEach: (cb: (doc: { id: string; data: () => Record<string, unknown> }) => void) => {
          for (const [k, v] of docs.entries()) {
            if (k.startsWith(`${name}/`)) cb({ id: k.slice(name.length + 1), data: () => v });
          }
        },
      }),
    });
    const firestore = {
      collection: () => ({
        doc: () => ({ collection: makeCollection }),
      }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          create: (ref: { path: string }, value: Record<string, unknown>) => {
            docs.set(ref.path, value);
          },
        }),
    };
    const call = createChecklistHandler({
      firestore,
      resolveRoleForEmail: async () => 'admin',
      now: () => new Date('2026-11-19T14:00:00Z'),
    });
    const context = { auth: { uid: 'u-1', token: { name: 'Dra. Prueba', email: 'a@b.test' } } };
    const catalog = await call({ action: 'templates' }, context);
    expect(catalog.templates.map((t: { title: string }) => t.title)).toEqual([
      'IAAS · Seguimiento de cirugías trazadoras',
      'IAAS · Supervisión de la indicación de tacto vaginal',
    ]);
    const code = 'PT-00000000-0000-4000-8000-000000000009';
    const applied = await call(
      {
        action: 'apply',
        uid: 'u-1',
        code,
        episode: '66009',
        document: '12345678-5',
        templateId: 'vigilancia-cirugias',
        version: 1,
        answers: {
          cirugia: 'Apendicectomía',
          'fecha-cirugia': '2026-11-18',
          'primer-control': '2026-11-19',
          'observacion-1': 'Herida limpia',
        },
      },
      context
    );
    expect(applied.record.censusDate).toBe('2026-11-18');
    expect(applied.record.patient).toEqual({
      name: 'Paciente Sintético',
      document: '12.345.678-5',
      episode: '66009',
    });
  });
});
