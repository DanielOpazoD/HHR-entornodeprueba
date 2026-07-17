import { describe, expect, it } from 'vitest';
import {
  buildScoresCellModel,
  resolveAgeYears,
} from '@/features/census/controllers/evaluationScoresCellController';
import type { PatientData } from '@/types/domain/patient';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';

const entry = (over: Partial<EvaluationScoreEntry>): EvaluationScoreEntry => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 1,
  total: 17,
  severity: 'Riesgo bajo',
  recordedDate: '2026-07-10',
  recordedAt: '10-07-2026 08:00:00 -06:00',
  ...over,
});

const patient = (over: Partial<PatientData> = {}): PatientData =>
  ({ patientName: 'Ana Perez', rut: '1-9', age: '59', ...over }) as unknown as PatientData;

describe('resolveAgeYears', () => {
  it('prefers birthDate (age at the census day) over the stored age string', () => {
    const p = patient({ birthDate: '2011-08-01', age: '99' });
    expect(resolveAgeYears(p, '2026-07-10')).toBe(14); // birthday not reached yet → pediatric
    expect(resolveAgeYears(p, '2026-08-01')).toBe(15); // birthday → adult
  });

  it('falls back to the age string and returns null when unparseable', () => {
    expect(resolveAgeYears(patient({ age: '77' }), '2026-07-10')).toBe(77);
    expect(resolveAgeYears(patient({ age: '' }), '2026-07-10')).toBeNull();
  });
});

describe('buildScoresCellModel — Braden countdown', () => {
  it('riesgo bajo shows the days-remaining counter ("Faltan X días")', () => {
    // Braden 17 adult (bajo → cada 7 días), taken on the 10th, viewed on the 12th → 5 days left.
    const model = buildScoresCellModel(
      patient({ evaluationScores: { braden: entry({}) } }),
      '2026-07-12'
    );
    expect(model.braden?.assessment.riskLevel).toBe('bajo');
    expect(model.braden?.chipCountdown).toBe('5d');
    expect(model.braden?.countdownLabel).toBe('Faltan 5 días para repetir la escala');
    expect(model.alertUrgency).toBe('ok');
  });

  it('when the deadline arrives it visually asks to reapply ("Reaplicar hoy")', () => {
    const model = buildScoresCellModel(
      patient({ evaluationScores: { braden: entry({}) } }),
      '2026-07-17' // recorded +7 → due today
    );
    expect(model.braden?.chipCountdown).toBe('hoy');
    expect(model.braden?.countdownLabel).toBe('Reaplicar hoy');
    expect(model.alertUrgency).toBe('due');
  });

  it('past the deadline it reports how long it has been overdue', () => {
    const model = buildScoresCellModel(
      patient({ evaluationScores: { braden: entry({}) } }),
      '2026-07-19' // due the 17th → 2 days overdue
    );
    expect(model.braden?.chipCountdown).toBe('-2d');
    expect(model.braden?.countdownLabel).toBe('Vencida hace 2 días — reaplicar');
    expect(model.alertUrgency).toBe('overdue');
  });

  it('uses the pediatric band: Braden 15 at age 8 is riesgo medio (cada 3 días)', () => {
    const model = buildScoresCellModel(
      patient({ age: '8', evaluationScores: { braden: entry({ total: 15 }) } }),
      '2026-07-10'
    );
    expect(model.braden?.assessment.riskLevel).toBe('medio');
    expect(model.braden?.assessment.conducta.aplicacion).toBe('Cada 3 días');
  });
});

describe('buildScoresCellModel — Downton and history', () => {
  it('maps Downton severity text to a level for coloring', () => {
    const downton = entry({ code: 'DOWNTON', total: 5, severity: 'Riesgo alto' });
    const model = buildScoresCellModel(patient({ evaluationScores: { downton } }), '2026-07-10');
    expect(model.downton?.level).toBe('alto');
    expect(model.hasAny).toBe(true);
    expect(model.braden).toBeNull();
  });

  it('Downton follows the same reapplication cadence as Braden (alto → diario) and drives the alert', () => {
    // Downton alto recorded on the 10th, viewed on the 11th → due today (cadencia diaria).
    const downton = entry({
      code: 'DOWNTON',
      total: 5,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-10',
    });
    const model = buildScoresCellModel(patient({ evaluationScores: { downton } }), '2026-07-11');
    expect(model.downton?.reapplication?.urgency).toBe('due');
    expect(model.downton?.chipCountdown).toBe('hoy');
    expect(model.downton?.countdownLabel).toBe('Reaplicar hoy');
    expect(model.alertUrgency).toBe('due'); // worst across scales, not Braden-only

    // Riesgo bajo → cada 7 días: recorded 10th, viewed 11th → 6 days left, no alert.
    const bajo = entry({
      code: 'DOWNTON',
      total: 1,
      severity: 'Riesgo bajo',
      recordedDate: '2026-07-10',
    });
    const calm = buildScoresCellModel(
      patient({ evaluationScores: { downton: bajo } }),
      '2026-07-11'
    );
    expect(calm.downton?.chipCountdown).toBe('6d');
    expect(calm.alertUrgency).toBe('ok');
  });

  it('maps an imported CUDYR to a band and marks the cell as having content', () => {
    const model = buildScoresCellModel(
      patient({
        evaluationScores: {
          cudyr: { category: 'D3', recordedDate: '2026-07-10', source: 'Eloísa (Rayen)' },
        },
      }),
      '2026-07-10'
    );
    expect(model.cudyr?.category).toBe('D3');
    expect(model.cudyr?.band).toBe('D');
    expect(model.hasAny).toBe(true);
    expect(model.braden).toBeNull();
  });

  it('hides a stale or zero CUDYR that does not belong to the selected census', () => {
    const stale = buildScoresCellModel(
      patient({
        evaluationScores: {
          cudyr: { category: 'C1', recordedDate: '2026-07-15', source: 'Eloísa' },
        },
      }),
      '2026-07-16'
    );
    const zero = buildScoresCellModel(
      patient({
        evaluationScores: {
          cudyr: { category: '0', recordedDate: '2026-07-16', source: 'Eloísa' },
        },
      }),
      '2026-07-16'
    );

    expect(stale.cudyr).toBeNull();
    expect(zero.cudyr).toBeNull();
  });

  it('hides a legacy CUDYR misdated as 16-jul when its 08:37 timestamp belongs to census 15-jul', () => {
    const model = buildScoresCellModel(
      patient({
        evaluationScores: {
          cudyr: {
            category: 'C1',
            recordedDate: '2026-07-16',
            recordedAt: '2026-07-16T14:37:00+00:00',
            source: 'Eloísa',
          },
        },
      }),
      '2026-07-16'
    );

    expect(model.cudyr).toBeNull();
  });

  it('exposes the unified history and handles a patient without scores', () => {
    const history = [entry({ encounterEventId: 2 }), entry({ encounterEventId: 1 })];
    const withHistory = buildScoresCellModel(
      patient({ evaluationScores: { braden: entry({}), history } }),
      '2026-07-10'
    );
    expect(withHistory.history).toHaveLength(2);

    const empty = buildScoresCellModel(patient(), '2026-07-10');
    expect(empty.hasAny).toBe(false);
    expect(empty.alertUrgency).toBe('ok');
  });
});
