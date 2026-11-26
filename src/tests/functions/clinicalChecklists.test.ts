// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {
  applicationFrom,
  evolutionText,
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
  it.each([
    { id: 'hhr-lpp-braden-adulto', min: 6, max: 23, high: 12, moderate: 15 },
    { id: 'hhr-lpp-braden-q', min: 7, max: 28, high: 16, moderate: 21 },
  ])(
    'clasifica todos los totales válidos de $id y exige cada subfactor',
    ({ id, min, max, high, moderate }) => {
      const template = templates.find((item: { id: string }) => item.id === id);
      expect(templateFrom(template).fields).toEqual(template.fields);
      const fields = template.fields.filter((field: { type: string }) => field.type === 'choice');
      expect(fields.length).toBe(min);
      for (let total = min; total <= max; total++) {
        const answers: Record<string, string> = {
          fecha: '2026-11-24',
          hora: '08:15',
        };
        let remaining = total - min;
        for (const field of fields) {
          const index = Math.min(remaining, field.options.length - 1);
          answers[field.id] = field.options[index].label;
          remaining -= index;
        }
        const result = applicationFrom(template, answers);
        const risk = total <= high ? 'alto' : total <= moderate ? 'moderado' : 'bajo';
        const reassess =
          total <= high ? 'Cada 24 h' : total <= moderate ? 'Cada 72 h' : 'Cada 7 días';
        expect(result.score).toMatchObject({ points: total, maximum: max, risk, reassess });
        expect(result.score.carePlan).toEqual(template.carePlans[risk]);
        expect(Object.keys(result.score.subscores).length).toBe(min);
        const note = evolutionText({ ...result, template, savedAt: '2026-11-24T15:00:00Z' });
        expect(note).toContain('Riesgo de LPP según escala:');
        expect(note).toContain('(' + risk + ')');
        expect(note).toContain('Reevaluar: ' + reassess);
        expect(note).toContain('Cuidados planeados según riesgo:');
        for (const field of fields) {
          expect(note).toContain(answers[field.id]);
          expect(() => applicationFrom(template, { ...answers, [field.id]: '' })).toThrow(
            'Completa'
          );
        }
      }
    }
  );

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
      where: (field: string, _op: string, target: unknown) => ({
        get: async () => ({
          forEach: (cb: (doc: { id: string; data: () => Record<string, unknown> }) => void) => {
            for (const [k, v] of docs.entries()) {
              if (k.startsWith(`${name}/`) && v[field] === target)
                cb({ id: k.slice(name.length + 1), data: () => v });
            }
          },
        }),
      }),
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
      'LPP · Braden adulto (≥15 años)',
      'LPP · Braden Q pediátrico (30 días a <15 años)',
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

    const adult = catalog.templates.find((t: { id: string }) => t.id === 'hhr-lpp-braden-adulto');
    await expect(
      call({ action: 'configure', template: adult, version: 1 }, context)
    ).rejects.toThrow('Norma Técnica');
    const choices = [3, 2, 3, 2, 3, 2];
    const scoredFields = adult.fields.filter((f: { type: string }) => f.type === 'choice');
    const answers = Object.fromEntries(
      scoredFields.map((f: { id: string; options: { label: string }[] }, i: number) => [
        f.id,
        f.options[choices[i] - 1].label,
      ])
    );
    const application = {
      action: 'apply',
      uid: 'u-1',
      code: 'PT-00000000-0000-4000-8000-000000000010',
      episode: '66009',
      document: '12345678-5',
      templateId: adult.id,
      version: adult.version,
      answers: {
        ...answers,
        fecha: '2026-11-19',
        hora: '08:15',
        piel: 'Piel indemne en caso sintético',
      },
    };
    const receipt = await call(application, context);
    expect(receipt.record.score).toEqual({
      points: 15,
      maximum: 23,
      risk: 'moderado',
      reassess: 'Cada 72 h',
      subscores: { PS: 3, H: 2, A: 3, M: 2, N: 3, F: 2 },
      carePlan: [
        'Posición: cada 4 h con SEMP adecuada; sin ella, cada 2 h.',
        'Proteger prominencias óseas; mantener piel seca e hidratada.',
      ],
    });
    expect(receipt.record.evolution).toContain('Subpuntajes: PS 3 · H 2 · A 3 · M 2 · N 3 · F 2');
    expect(receipt.record.evolution).toContain('Riesgo de LPP según escala: Moderado (moderado)');
    expect(await call(application, context)).toEqual(receipt);
    expect(await call({ action: 'get', code: application.code }, context)).toEqual(receipt);
    const history = await call(
      { action: 'history', episode: '66009', scaleGroup: 'braden' },
      context
    );
    expect(history.records).toEqual([receipt.record]);
  });
});
