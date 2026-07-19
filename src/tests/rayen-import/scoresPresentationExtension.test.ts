// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../extension/hhr-scores-presentation.js';

type PresentationOptions = {
  patient: Record<string, any>;
  instrument: string;
  unavailableReason?: string;
  persistedProtection?: Record<string, any> | null;
  uncertainWrite?: Record<string, any> | null;
  canWriteInstrument?: boolean;
  recoveryReady?: boolean;
  formatDateTimeLabel?: (value: unknown) => string;
};

type ScoresPresentation = {
  normalizeScoreHistory: (options: Record<string, unknown>) => Array<Record<string, any>>;
  buildPatientPresentation: (options: PresentationOptions) => Record<string, any>;
  scoreFieldPresentation: (options: Record<string, any>) => Record<string, any>;
  mergeSavedScore: (options: Record<string, any>) => unknown;
  recoveryResultPresentation: (result: Record<string, any> | null) => Record<string, any>;
};

const owner = () =>
  (globalThis as typeof globalThis & { HhrScoresPresentation: ScoresPresentation })
    .HhrScoresPresentation;

const patient = (scores: Record<string, unknown>) => ({
  encounterId: '401',
  name: 'Ana Riroroko',
  run: '12.345.678-9',
  bed: 'C2',
  room: 'C',
  service: 'MQ',
  scores,
});

const build = (overrides: Partial<PresentationOptions> = {}) =>
  owner().buildPatientPresentation({
    patient: patient({ CUDYR: null }),
    instrument: 'CUDYR',
    unavailableReason: '',
    persistedProtection: null,
    uncertainWrite: null,
    canWriteInstrument: true,
    recoveryReady: false,
    formatDateTimeLabel: value => `fecha:${String(value || '')}`,
    ...overrides,
  });

describe('HHR Scores presentation model', () => {
  beforeEach(() => {
    expect(Object.isFrozen(owner())).toBe(true);
  });

  it('normalizes complete CUDYR history without leaking transport field names', () => {
    const history = owner().normalizeScoreHistory({
      instrument: 'CUDYR',
      raw: {
        history: [
          {
            category: 'B2',
            recordedAt: '2026-07-18T08:00:00Z',
            author: 'Enf. Ana',
            authorRole: 'Enfermería',
            dependencyScore: 9,
            riskScore: 13,
          },
        ],
      },
      unavailableReason: '',
    });

    expect(history).toEqual([
      {
        total: 'B2',
        dateTime: '2026-07-18T08:00:00Z',
        author: 'Enf. Ana',
        authorRole: 'Enfermería',
        dependencyScore: 9,
        riskScore: 13,
      },
    ]);
  });

  it('uses the unchanged CUDYR fallback and supports an empty history', () => {
    expect(
      owner().normalizeScoreHistory({
        instrument: 'CUDYR',
        raw: {
          crdValue: 'D3',
          crdDateTime: '2026-07-17T08:00:00Z',
          authorRole: 'Enfermería',
        },
        unavailableReason: '',
      })
    ).toEqual([
      {
        total: 'D3',
        dateTime: '2026-07-17T08:00:00Z',
        author: '',
        authorRole: 'Enfermería',
      },
    ]);
    expect(
      owner().normalizeScoreHistory({
        instrument: 'CUDYR',
        raw: {},
        unavailableReason: '',
      })
    ).toEqual([]);
  });

  it.each(['BRADEN', 'DOWNTON'])('keeps the verified %s history unchanged', instrument => {
    const raw = [{ total: 12, severity: 'Alto', dateTime: '2026-07-18' }];
    expect(owner().normalizeScoreHistory({ instrument, raw, unavailableReason: '' })).toBe(raw);
    expect(owner().normalizeScoreHistory({ instrument, raw: {}, unavailableReason: '' })).toEqual(
      []
    );
  });

  it('derives the exact latest value, professional and CUDYR history labels', () => {
    const presentation = build({
      patient: patient({
        CUDYR: {
          history: [
            {
              category: 'B2',
              recordedAt: '2026-07-18T08:00:00Z',
              author: 'Enf. Ana',
              authorRole: 'Enfermería',
              dependencyScore: 9,
              riskScore: 13,
            },
          ],
        },
      }),
    });

    expect(presentation).toMatchObject({
      identity: {
        bed: 'C2',
        name: 'Ana Riroroko',
        meta: '12.345.678-9 · MQ',
      },
      latest: {
        value: 'B2',
        date: 'fecha:2026-07-18T08:00:00Z',
        professional: { text: 'Enf. Ana', role: 'Enfermería' },
      },
      history: {
        label: '1 categorización',
        title: '',
        items: [
          'B2 · fecha:2026-07-18T08:00:00Z · Enf. Ana (Enfermería) · Dependencia 9 / Riesgo 13',
        ],
      },
      action: { kind: 'register', text: 'Registrar', disabled: false, title: '' },
    });
  });

  it('fails closed when a score history read is incomplete', () => {
    const presentation = build({
      unavailableReason: 'Falló la lectura completa de formularios.',
      patient: patient({ BRADEN: [{ total: 9, dateTime: 'fecha antigua' }] }),
      instrument: 'BRADEN',
    });

    expect(presentation.latest).toEqual({
      value: 'No verificable',
      date: '-',
      professional: { text: '-', role: '' },
    });
    expect(presentation.history).toEqual({
      label: 'Lectura no disponible',
      title: 'Falló la lectura completa de formularios.',
      items: [],
    });
    expect(presentation.action).toMatchObject({
      kind: 'register',
      disabled: true,
      title: 'No se puede registrar mientras el historial completo no sea verificable.',
    });
  });

  it('represents local uncertainty and preserves the last visible score', () => {
    const presentation = build({
      patient: patient({
        BRADEN: [
          {
            total: 14,
            severity: 'Riesgo moderado',
            dateTime: '2026-07-18',
            authorRole: 'Enfermería',
          },
        ],
      }),
      instrument: 'BRADEN',
      uncertainWrite: { error: 'Confirmación pendiente.' },
    });

    expect(presentation.latest.value).toBe('14 · Riesgo moderado');
    expect(presentation.latest.professional).toEqual({ text: 'Enfermería', role: '' });
    expect(presentation.history).toMatchObject({
      label: 'Protegido · revisa el último valor',
      title: 'Confirmación pendiente.',
    });
    expect(presentation.action).toMatchObject({
      kind: 'register',
      disabled: true,
      title: 'Revisa el estado en Eloísa antes de registrar otra aplicación.',
    });
  });

  it('only enables persisted-protection recovery after a fresh verifiable read', () => {
    const protection = { generationId: 'generation-1' };
    expect(
      build({
        persistedProtection: protection,
        uncertainWrite: protection,
        recoveryReady: false,
      }).action
    ).toEqual({
      kind: 'recovery',
      text: 'Espera y actualiza',
      disabled: true,
      title: 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.',
    });
    expect(
      build({
        persistedProtection: protection,
        uncertainWrite: protection,
        recoveryReady: true,
      }).action
    ).toEqual({
      kind: 'recovery',
      text: 'Actualizar y revisar',
      disabled: false,
      title: 'Libera únicamente después de revisar el último valor e historial visibles.',
    });
  });

  it('keeps invalid persisted protection disabled even when its delay elapsed', () => {
    const action = build({
      persistedProtection: { generationId: 'generation-1', error: 'Protección inválida.' },
      recoveryReady: true,
    }).action;

    expect(action.text).toBe('Actualizar y revisar');
    expect(action.disabled).toBe(true);
  });

  it('builds inert form descriptors with unchanged ids, options and accessibility metadata', () => {
    const view = owner().scoreFieldPresentation({
      field: {
        id: 'riesgo caída',
        label: 'Riesgo de caída',
        type: 7,
        typeId: 2,
        explanation: 'Selecciona todas las condiciones.',
        options: [{ id: 'op-1', value: 3, score: 4, description: 'Antecedente' }],
      },
      index: 0,
      encounterId: '401',
      instrument: 'CUDYR',
    });

    expect(view).toMatchObject({
      label: '1. Riesgo de caída',
      controlId: 'hhr-score-401-cudyr-riesgo-ca-da-0',
      multiple: true,
      options: [{ value: '3', optionId: 'op-1', score: '4', label: '[3] Antecedente' }],
    });
    expect(view.descriptor.children[1]).toMatchObject({
      tag: 'span',
      properties: { id: 'hhr-score-401-cudyr-riesgo-ca-da-0-help' },
    });
  });

  it('merges saved CUDYR and scale records into the unchanged local presentation cache', () => {
    const previous = { history: [{ category: 'C1' }] };
    const cudyr = owner().mergeSavedScore({
      instrument: 'CUDYR',
      currentScore: previous,
      record: { total: 'B2', dateTime: '2026-07-18', dependency: 9, risk: 13 },
      currentProfessional: 'Enf. Ana',
    });
    expect(cudyr).toMatchObject({
      crdValue: 'B2',
      source: 'ficha_medico',
      history: [{ category: 'B2', author: 'Enf. Ana' }, { category: 'C1' }],
    });
    const record = { total: 12 };
    expect(
      owner().mergeSavedScore({
        instrument: 'BRADEN',
        currentScore: [{ total: 13 }],
        record,
      })
    ).toEqual([record, { total: 13 }]);
  });

  it('keeps recovery result labels exact for cancellation and read errors', () => {
    expect(owner().recoveryResultPresentation({ cancelled: true })).toEqual({
      complete: false,
      text: 'Protegido',
      title: 'La protección se mantuvo porque no se confirmó la lectura fresca.',
    });
    expect(owner().recoveryResultPresentation({ error: 'Lectura fallida.' })).toEqual({
      complete: false,
      text: 'No se liberó',
      title: 'Lectura fallida.',
    });
  });
});

declare global {
  var HhrScoresPresentation: ScoresPresentation;
}
