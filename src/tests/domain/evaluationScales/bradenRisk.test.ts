import { describe, expect, it } from 'vitest';
import {
  classifyBradenRisk,
  bradenReapplicationStatus,
  assessBraden,
  BRADEN_CONDUCTA,
} from '@/domain/evaluationScales/bradenRisk';

describe('classifyBradenRisk', () => {
  it('classifies the adult band (≥15a): ≤12 alto · 13–14 medio · ≥15 bajo', () => {
    expect(classifyBradenRisk(11, 40)).toBe('alto');
    expect(classifyBradenRisk(12, 40)).toBe('alto'); // gap score 12 → alto (safer)
    expect(classifyBradenRisk(13, 40)).toBe('medio');
    expect(classifyBradenRisk(14, 40)).toBe('medio');
    expect(classifyBradenRisk(15, 40)).toBe('bajo'); // gap score 15 → bajo
    expect(classifyBradenRisk(17, 40)).toBe('bajo');
    expect(classifyBradenRisk(23, 40)).toBe('bajo');
  });

  it('classifies the pediatric band (0–14a): ≤12 alto · 13–15 medio · ≥16 bajo', () => {
    expect(classifyBradenRisk(12, 8)).toBe('alto');
    expect(classifyBradenRisk(13, 8)).toBe('medio');
    expect(classifyBradenRisk(15, 8)).toBe('medio'); // 15 is medio for pediatric, bajo for adult
    expect(classifyBradenRisk(16, 8)).toBe('bajo'); // gap score 16 → bajo
    expect(classifyBradenRisk(20, 8)).toBe('bajo');
  });

  it('treats age 15 as adult (band boundary)', () => {
    expect(classifyBradenRisk(15, 15)).toBe('bajo'); // adult band
    expect(classifyBradenRisk(15, 14)).toBe('medio'); // pediatric band
  });
});

describe('BRADEN_CONDUCTA', () => {
  it('maps each risk level to its reapplication cadence', () => {
    expect(BRADEN_CONDUCTA.bajo.reapplyDays).toBe(7);
    expect(BRADEN_CONDUCTA.medio.reapplyDays).toBe(3);
    expect(BRADEN_CONDUCTA.alto.reapplyDays).toBe(1);
    expect(BRADEN_CONDUCTA.alto.cuidados).toContain('Colchón antiescaras o viscoelástico');
  });
});

describe('bradenReapplicationStatus', () => {
  it('is overdue when the due date is before the reference day', () => {
    // bajo → +7 days: recorded 01, due 08; reference 10 → overdue by 2.
    const status = bradenReapplicationStatus('2026-07-01', 'bajo', '2026-07-10');
    expect(status.dueDate).toBe('2026-07-08');
    expect(status.daysUntilDue).toBe(-2);
    expect(status.urgency).toBe('overdue');
  });

  it('is due on the exact due date', () => {
    // alto → +1 day: recorded 09, due 10; reference 10 → due today.
    const status = bradenReapplicationStatus('2026-07-09', 'alto', '2026-07-10');
    expect(status.dueDate).toBe('2026-07-10');
    expect(status.daysUntilDue).toBe(0);
    expect(status.urgency).toBe('due');
  });

  it('is ok when the due date is still ahead', () => {
    // medio → +3 days: recorded 10, due 13; reference 11 → ok, 2 days ahead.
    const status = bradenReapplicationStatus('2026-07-10', 'medio', '2026-07-11');
    expect(status.dueDate).toBe('2026-07-13');
    expect(status.daysUntilDue).toBe(2);
    expect(status.urgency).toBe('ok');
  });
});

describe('assessBraden', () => {
  it('combines risk level, conducta and reapplication for a real adult case', () => {
    // Braden 17, adult, recorded 2026-07-10, viewing that same census day.
    const assessment = assessBraden(17, 59, '2026-07-10', '2026-07-10');
    expect(assessment.riskLevel).toBe('bajo');
    expect(assessment.conducta.aplicacion).toBe('Cada 7 días');
    expect(assessment.reapplication.dueDate).toBe('2026-07-17');
    expect(assessment.reapplication.urgency).toBe('ok');
  });

  it('flags a high-risk patient as due the day after it was taken', () => {
    const assessment = assessBraden(11, 70, '2026-07-09', '2026-07-10');
    expect(assessment.riskLevel).toBe('alto');
    expect(assessment.conducta.aplicacion).toBe('Diariamente');
    expect(assessment.reapplication.urgency).toBe('due');
  });
});
