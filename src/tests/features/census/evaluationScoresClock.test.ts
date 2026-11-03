import { describe, expect, it } from 'vitest';

import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';

// Braden and Downton keep the clock Eloísa printed, mainland Chile (TIME-02). The census shows
// and counts them on the Rapa Nui clock without rewriting what is stored.
const braden = (over: Partial<EvaluationScoreEntry>): EvaluationScoreEntry => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 20261001101500,
  total: 17,
  severity: 'Riesgo bajo',
  recordedDate: '2026-10-01',
  recordedAt: '2026-10-01T10:15:00',
  ...over,
});

const patient = (evaluationScores: PatientData['evaluationScores']): PatientData =>
  ({ patientName: 'Paciente Sintético', rut: '1-9', age: '59', evaluationScores }) as PatientData;

describe('Braden and Downton on the hospital clock', () => {
  it('shows a history JSON application two hours earlier, as it happened in Rapa Nui', () => {
    const model = buildScoresCellModel(patient({ braden: braden({}) }), '2026-10-01');

    expect(model.braden?.entry).toMatchObject({
      recordedDate: '2026-10-01',
      recordedAt: '2026-10-01T08:15:00',
    });
    expect(model.braden?.application).toMatchObject({ recordedAt: '2026-10-01T08:15:00' });
  });

  it('puts a mainland 00:30 application on the previous Rapa Nui day and counts its cadence from it', () => {
    const late = braden({
      encounterEventId: 20261002003000,
      recordedDate: '2026-10-02',
      recordedAt: '2026-10-02T00:30:00',
    });

    // The 1st's census already shows it; a low risk is due 7 days after the 1st.
    const model = buildScoresCellModel(patient({ braden: late, history: [late] }), '2026-10-01');

    expect(model.braden?.entry).toMatchObject({
      recordedDate: '2026-10-01',
      recordedAt: '2026-10-01T22:30:00',
    });
    expect(model.history.map(entry => entry.recordedAt)).toEqual(['2026-10-01T22:30:00']);
    expect(model.braden?.countdownLabel).toBe('Faltan 7 días para repetir la escala');
  });

  it('converts the scale report stamp by its own offset', () => {
    const model = buildScoresCellModel(
      patient({
        downton: {
          ...braden({ recordedAt: '01-10-2026 10:15:00 -03:00' }),
          code: 'DOWNTON',
          name: 'Escala de Riesgo de caídas (Downton)',
          total: 2,
          severity: 'Riesgo bajo',
          latestApplication: {
            recordedDate: '2026-10-01',
            recordedAt: '01-10-2026 08:15:00 -05:00',
          },
        },
      }),
      '2026-10-01'
    );

    expect(model.downton?.entry.recordedAt).toBe('2026-10-01T08:15:00');
    expect(model.downton?.application.recordedAt).toBe('2026-10-01T08:15:00');
  });

  it('does not rewrite the stored applications', () => {
    const stored = braden({
      latestApplication: { recordedDate: '2026-10-01', recordedAt: '2026-10-01T10:15:00' },
    });
    const scores = { braden: stored, history: [stored] };

    buildScoresCellModel(patient(scores), '2026-10-01');

    expect(scores.braden).toBe(stored);
    expect(stored.recordedAt).toBe('2026-10-01T10:15:00');
    expect(stored.latestApplication?.recordedAt).toBe('2026-10-01T10:15:00');
  });
});
