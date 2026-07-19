// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve('extension/clinical-score-write-model.js'), 'utf8');

type ScoreWriteModel = {
  prepareEvaluationSubmission: (input: Record<string, unknown>) => Record<string, unknown>;
  buildEvaluationPayload: (input: Record<string, unknown>) => Record<string, unknown>;
  readCreatedIdentity: (created: unknown) => { id: string; guid: string };
  matchesEvaluationForm: (input: Record<string, unknown>) => boolean;
  buildEvaluationRecord: (input: Record<string, unknown>) => Record<string, unknown>;
};

const loadModel = () => {
  const context = vm.createContext({ Map });
  vm.runInContext(source, context, { filename: 'clinical-score-write-model.js' });
  return (context as unknown as { HhrClinicalScoreWriteModel: ScoreWriteModel })
    .HhrClinicalScoreWriteModel;
};

const definition = {
  metaFormId: '10',
  formId: '20',
  scoreFieldId: 'total',
  resultFieldId: 'classification',
  fields: [
    {
      id: 'mobility',
      type: 6,
      required: true,
      options: [
        { id: 'limited', score: 2 },
        { id: 'full', score: 4 },
      ],
    },
    {
      id: 'risks',
      type: 7,
      required: false,
      options: [
        { id: 'fall', score: 1 },
        { id: 'drug', score: 2 },
      ],
    },
    { id: 'note', type: 1, required: false, options: [] },
  ],
  results: [
    { minScore: 0, maxScore: 3, valueId: 'high', valueName: 'Riesgo alto' },
    { minScore: 4, maxScore: 10, valueId: 'low', valueName: 'Riesgo bajo' },
  ],
};

describe('clinical score write pure model', () => {
  it('normalizes answers and calculates the official result without I/O', () => {
    expect(
      loadModel().prepareEvaluationSubmission({
        definition,
        instrument: 'BRADEN',
        answers: { mobility: 'full', risks: 'fall,drug', note: 'Observación' },
      })
    ).toEqual({
      total: 7,
      result: { minScore: 4, maxScore: 10, valueId: 'low', valueName: 'Riesgo bajo' },
      metaCampList: [
        { id: 'mobility', value: 'full' },
        { id: 'risks', value: 'fall,drug' },
        { id: 'note', value: 'Observación' },
        { id: 'total', value: '7' },
        { id: 'classification', value: 'low' },
      ],
    });
  });

  it.each([
    [{ mobility: '' }, 'Completa todas las respuestas'],
    [{ mobility: 'unknown' }, 'Completa todas las respuestas'],
  ])('rejects an invalid required selection %#', (answers, expectedMessage) => {
    const result = loadModel().prepareEvaluationSubmission({
      definition,
      instrument: 'BRADEN',
      answers,
    });

    expect(String(result.error)).toContain(expectedMessage);
  });

  it('rejects a definition whose selected option has no numeric score', () => {
    const malformed = {
      ...definition,
      fields: [{ id: 'risk', type: 6, required: true, options: [{ id: 'yes' }] }],
    };

    const result = loadModel().prepareEvaluationSubmission({
      definition: malformed,
      instrument: 'DOWNTON',
      answers: { risk: 'yes' },
    });

    expect(String(result.error)).toContain('no informó el puntaje');
  });

  it('builds the exact Eloisa transport payload', () => {
    const payload = loadModel().buildEvaluationPayload({
      encId: '902',
      definition,
      metaCampList: [{ id: 'total', value: '4' }],
      clinicalAge: '26060400',
      administrativeSexId: 1,
      info: {
        facId: '1342',
        practitionerId: '77',
        practitionerRoleId: '88',
      },
    });

    expect(payload).toEqual({
      encounterFormEntryTransport: {
        administrativeSexId: 1,
        age: '26060400',
        facilityId: 1342,
        healthCarePractitionerId: 77,
        healthCarePractitionerRoleId: 88,
        metaFormId: 10,
        formId: 20,
        metaCampList: [{ id: 'total', value: '4' }],
        isRedo: false,
        encounterEventTypeId: 2,
      },
      confidentialityLevelId: 4,
      encounterEventId: 0,
      healthCarePractitionerRoleId: 88,
      authorHealthCarePractitionerId: 77,
      authorHealthCarePractitionerRoleId: 88,
      healthCarePractitionerId: 77,
      encounterId: 902,
    });
  });

  it('matches only a new form with the same identity, author and values', () => {
    const model = loadModel();
    const base = {
      form: {
        id: '55',
        formId: '20',
        authorHealthCarePractitionerId: '77',
        metaCampList: [{ id: 'total', value: '4' }],
      },
      formId: '20',
      createdIdentity: { id: '55', guid: '' },
      baselineContains: false,
      practitionerId: '77',
      expectedValues: [{ id: 'total', value: '4' }],
      hasNewTimestamp: true,
    };

    expect(model.matchesEvaluationForm(base)).toBe(true);
    expect(model.matchesEvaluationForm({ ...base, baselineContains: true })).toBe(false);
    expect(model.matchesEvaluationForm({ ...base, hasNewTimestamp: false })).toBe(false);
    expect(
      model.matchesEvaluationForm({
        ...base,
        form: { ...base.form, authorHealthCarePractitionerId: '99' },
      })
    ).toBe(false);
    expect(
      model.matchesEvaluationForm({
        ...base,
        form: { ...base.form, metaCampList: [{ id: 'total', value: '3' }] },
      })
    ).toBe(false);
  });

  it('requires author attribution when Eloisa returns no created identity', () => {
    const model = loadModel();
    const input = {
      form: {
        formId: '20',
        authorHealthCarePractitionerId: '99',
        metaCampList: [{ id: 'total', value: '4' }],
      },
      formId: '20',
      createdIdentity: model.readCreatedIdentity(null),
      baselineContains: false,
      practitionerId: '77',
      expectedValues: [{ id: 'total', value: '4' }],
      hasNewTimestamp: true,
    };

    expect(model.matchesEvaluationForm(input)).toBe(false);
  });
});
