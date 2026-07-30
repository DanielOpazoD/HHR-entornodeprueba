import { describe, expect, it } from 'vitest';
import {
  buildScoresCellModel,
  dedupeScoreHistory,
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

  it('uses the latest application date independently from the selected same-day result', () => {
    const model = buildScoresCellModel(
      patient({
        evaluationScores: {
          braden: entry({
            total: 17,
            severity: 'Riesgo bajo',
            recordedDate: '2026-07-22',
            latestApplication: {
              recordedDate: '2026-07-23',
              recordedAt: '2026-07-23T13:00:00',
              archived: true,
            },
          }),
        },
      }),
      '2026-07-26'
    );

    expect(model.braden?.assessment.riskLevel).toBe('bajo');
    expect(model.braden?.application).toMatchObject({ recordedDate: '2026-07-23', archived: true });
    expect(model.braden?.chipCountdown).toBe('4d');
    expect(model.alertUrgency).toBe('ok');
  });

  it('repairs a stale application clock from a newer same-score history entry', () => {
    const current = entry({
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-23',
      latestApplication: {
        recordedDate: '2026-07-23',
        recordedAt: '2026-07-23T13:00:00',
      },
    });
    const reappliedToday = entry({
      encounterEventId: 20260726130119,
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-26',
      recordedAt: '2026-07-26T13:01:19',
      author: 'Nicole Palma',
    });

    const model = buildScoresCellModel(
      patient({ evaluationScores: { braden: current, history: [reappliedToday] } }),
      '2026-07-26'
    );

    expect(model.braden?.application).toMatchObject({
      recordedDate: '2026-07-26',
      author: 'Nicole Palma',
    });
    expect(model.braden?.chipCountdown).toBe('1d');
  });

  it('advances the cadence when a newer completed application has a different score', () => {
    const visibleResult = entry({
      total: 17,
      severity: 'Riesgo bajo',
      recordedDate: '2026-07-23',
      recordedAt: '2026-07-23T11:00:00',
      latestApplication: {
        recordedDate: '2026-07-23',
        recordedAt: '2026-07-23T11:00:00',
      },
    });
    const laterHiddenApplication = entry({
      encounterEventId: 20260724130000,
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-24',
      recordedAt: '2026-07-24T13:00:00',
      author: 'Nicole Palma',
      archived: true,
    });

    const model = buildScoresCellModel(
      patient({
        evaluationScores: { braden: visibleResult, history: [laterHiddenApplication] },
      }),
      '2026-07-26'
    );

    expect(model.braden?.total).toBe(17);
    expect(model.braden?.application).toMatchObject({
      recordedDate: '2026-07-24',
      author: 'Nicole Palma',
      archived: true,
    });
    expect(model.braden?.chipCountdown).toBe('5d');
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
  it('collapses an exact application attributed to different professionals', () => {
    const valeria = entry({
      code: 'DOWNTON',
      encounterEventId: 20260726161638,
      sourceOrder: 1,
      total: 3,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-26',
      recordedAt: '2026-07-26T16:16:38',
      author: 'Valeria Salfate',
    });
    const constanza = entry({
      code: 'DOWNTON',
      encounterEventId: 20260726161638,
      sourceOrder: 2,
      total: 3,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-26',
      recordedAt: '26-07-2026 16:16:38 -06:00',
      author: 'Constanza Guajardo',
    });

    expect(dedupeScoreHistory([valeria, constanza])).toEqual([
      expect.objectContaining({ author: 'Valeria Salfate' }),
    ]);
  });

  it('preserves exact-time applications when their item answers conflict', () => {
    const first = entry({
      code: 'DOWNTON',
      encounterEventId: 101,
      total: 3,
      severity: 'Riesgo alto',
      recordedAt: '2026-07-10T08:00:00',
      items: [{ id: 'DOWNTON_A', label: 'A', value: '1', valueName: 'Sí' }],
    });
    const second = entry({
      code: 'DOWNTON',
      encounterEventId: 101,
      total: 3,
      severity: 'Riesgo alto',
      recordedAt: '10-07-2026 08:00:00 -06:00',
      items: [{ id: 'DOWNTON_A', label: 'A', value: '0', valueName: 'No' }],
    });

    expect(dedupeScoreHistory([first, second])).toHaveLength(2);
  });

  it('preserves ambiguous minute-only applications even when their stable key matches', () => {
    const first = entry({
      code: 'DOWNTON',
      encounterEventId: 20260710080000,
      sourceOrder: 1,
      total: 3,
      recordedAt: '2026-07-10T08:00',
    });
    const second = entry({
      code: 'DOWNTON',
      encounterEventId: 20260710080000,
      sourceOrder: 2,
      total: 3,
      recordedAt: '10-07-2026 08:00 -06:00',
    });

    expect(dedupeScoreHistory([first, second])).toHaveLength(2);
  });

  it('does not use malformed clocks as application identity evidence', () => {
    const first = entry({
      code: 'DOWNTON',
      encounterEventId: 20260710250000,
      total: 3,
      recordedAt: '2026-07-10T25:00:00',
    });
    const second = entry({
      code: 'DOWNTON',
      encounterEventId: 20260710250000,
      total: 3,
      recordedAt: '10-07-2026 25:00:00 -06:00',
    });

    expect(dedupeScoreHistory([first, second])).toHaveLength(2);
  });

  it('collapses minute/second copies for display but preserves precise genuine repeats', () => {
    const minuteCopy = entry({
      code: 'DOWNTON',
      total: 3,
      recordedDate: '2026-07-26',
      recordedAt: '26-07-2026 13:01',
      author: 'Nicole Palma',
      authorRole: '',
    });
    const preciseCopy = entry({
      code: 'DOWNTON',
      encounterEventId: 20260726130119,
      total: 3,
      recordedDate: '2026-07-26',
      recordedAt: '2026-07-26T13:01:19',
      author: 'Nicole Palma',
      authorRole: 'Enfermera(o)',
    });
    const genuineRepeat = entry({
      code: 'DOWNTON',
      encounterEventId: 20260726130148,
      total: 3,
      recordedDate: '2026-07-26',
      recordedAt: '2026-07-26T13:01:48',
      author: 'Nicole Palma',
      authorRole: 'Enfermera(o)',
    });

    const deduped = dedupeScoreHistory([minuteCopy, preciseCopy, genuineRepeat]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({
      encounterEventId: 20260726130119,
      authorRole: 'Enfermera(o)',
    });
    expect(deduped[1].encounterEventId).toBe(20260726130148);
  });

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
    const history = [
      entry({ encounterEventId: 2, recordedAt: '2026-07-10T08:00:00' }),
      entry({ encounterEventId: 1, recordedAt: '2026-07-10T08:05:00' }),
    ];
    const withHistory = buildScoresCellModel(
      patient({ evaluationScores: { braden: entry({}), history } }),
      '2026-07-10'
    );
    expect(withHistory.history).toHaveLength(2);

    const archivedOnly = buildScoresCellModel(
      patient({ evaluationScores: { history: [entry({ archived: true })] } }),
      '2026-07-10'
    );
    expect(archivedOnly.hasAny).toBe(true);
    expect(archivedOnly.braden).toBeNull();

    const empty = buildScoresCellModel(patient(), '2026-07-10');
    expect(empty.hasAny).toBe(false);
    expect(empty.alertUrgency).toBe('ok');
  });

  it('does not expose future history in a backdated census row', () => {
    const model = buildScoresCellModel(
      patient({
        evaluationScores: {
          history: [entry({ recordedDate: '2026-07-11', archived: true })],
        },
      }),
      '2026-07-10'
    );

    expect(model.history).toEqual([]);
    expect(model.hasAny).toBe(false);
  });
});
