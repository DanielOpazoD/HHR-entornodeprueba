import { describe, expect, it } from 'vitest';
import {
  buildRowAcuity,
  buildCensusAttentionSummary,
} from '@/features/census/controllers/rowAcuityController';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';

const DAY = '2026-07-12';

const patient = (over: Partial<PatientData> = {}): PatientData =>
  ({ patientName: 'Ana Perez', rut: '1-9', age: '59', ...over }) as unknown as PatientData;

const vitals = (over: Partial<PatientVitalSigns>): PatientVitalSigns =>
  ({
    recordedAt: '12-07-2026 08:00',
    recordedDate: DAY,
    observations: null,
    ...over,
  }) as PatientVitalSigns;

const braden = (over: Partial<EvaluationScoreEntry>): EvaluationScoreEntry => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 1,
  total: 17, // adult → riesgo bajo → cadencia 7 días
  severity: 'Riesgo bajo',
  recordedDate: '2026-07-05',
  recordedAt: '05-07-2026 08:00',
  ...over,
});

describe('buildRowAcuity', () => {
  it('flags a critical vital (SatO₂ < 90) as alert', () => {
    const acuity = buildRowAcuity(patient({ vitalSigns: vitals({ spo2: 88 }) }), DAY);
    expect(acuity.level).toBe('alert');
    expect(acuity.reasons).toEqual([
      { kind: 'vital', level: 'alert', label: 'Signo vital crítico' },
    ]);
  });

  it('flags an out-of-range vital (SatO₂ 92) as watch', () => {
    const acuity = buildRowAcuity(patient({ vitalSigns: vitals({ spo2: 92 }) }), DAY);
    expect(acuity.level).toBe('watch');
    expect(acuity.reasons[0]).toMatchObject({ kind: 'vital', level: 'watch' });
  });

  it('flags an overdue nursing scale as alert', () => {
    // Braden bajo recorded 07-05 (7-day cadence) → due 07-12; viewed 07-15 → overdue.
    const acuity = buildRowAcuity(
      patient({ evaluationScores: { braden: braden({}) } }),
      '2026-07-15'
    );
    expect(acuity.level).toBe('alert');
    expect(acuity.reasons.some(r => r.kind === 'scale' && r.level === 'alert')).toBe(true);
  });

  it('flags isolation as watch', () => {
    const acuity = buildRowAcuity(patient({ isIsolated: true }), DAY);
    expect(acuity).toEqual({
      level: 'watch',
      reasons: [{ kind: 'isolation', level: 'watch', label: 'Paciente en aislamiento' }],
    });
  });

  it('takes the worst level and keeps every reason (critical vital + isolation)', () => {
    const acuity = buildRowAcuity(
      patient({ vitalSigns: vitals({ spo2: 85 }), isIsolated: true }),
      DAY
    );
    expect(acuity.level).toBe('alert');
    expect(acuity.reasons.map(r => r.kind)).toEqual(['vital', 'isolation']);
  });

  it('returns none with no reasons when nothing is surfaced', () => {
    const acuity = buildRowAcuity(patient({ vitalSigns: vitals({ spo2: 98 }) }), DAY);
    expect(acuity).toEqual({ level: 'none', reasons: [] });
  });
});

describe('buildCensusAttentionSummary', () => {
  it('tallies rows per kind and counts alert rows, skipping empty/blocked beds', () => {
    const summary = buildCensusAttentionSummary(
      {
        R1: patient({ vitalSigns: vitals({ spo2: 85 }) }), // alert vital
        R2: patient({ isIsolated: true }), // watch isolation
        R3: patient({ vitalSigns: vitals({ spo2: 98 }) }), // fine → skipped
        R4: patient({ patientName: '', vitalSigns: vitals({ spo2: 80 }) }), // empty bed → skipped
        R5: patient({ isBlocked: true, vitalSigns: vitals({ spo2: 80 }) }), // blocked → skipped
      },
      DAY
    );
    expect(summary).toEqual({ rows: 2, alertRows: 1, vital: 1, scale: 0, isolation: 1 });
  });

  it('counts a row once per kind even with two reasons of that kind', () => {
    const summary = buildCensusAttentionSummary(
      { R1: patient({ vitalSigns: vitals({ spo2: 85 }), isIsolated: true }) },
      DAY
    );
    expect(summary).toMatchObject({ rows: 1, alertRows: 1, vital: 1, isolation: 1 });
  });
});
