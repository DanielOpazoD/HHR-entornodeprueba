import { describe, expect, it } from 'vitest';

import {
  SCORE_DEFINITIONS,
  findScoreDefinition,
} from '@/features/clinical-library/domain/scoreDefinitions';
import {
  evaluateScore,
  findScoreBand,
  reachableScoreTotals,
  scoreMaxTotal,
  type ScoreDefinition,
} from '@/features/clinical-library/domain/scoreEngine';

const definition = (id: string): ScoreDefinition => {
  const found = findScoreDefinition(id);
  if (!found) throw new Error(`missing score ${id}`);
  return found;
};

describe('score definitions', () => {
  it('cover every reachable total with exactly one interpretation band', () => {
    for (const score of SCORE_DEFINITIONS) {
      const itemIds = score.items.map(item => item.id);
      expect(new Set(itemIds).size, score.id).toBe(itemIds.length);
      for (const total of reachableScoreTotals(score)) {
        const matching = score.bands.filter(band => total >= band.min && total <= band.max);
        expect(matching, `${score.id} total ${total}`).toHaveLength(1);
      }
      expect(Math.max(...score.bands.map(band => band.max)), score.id).toBeGreaterThanOrEqual(
        scoreMaxTotal(score)
      );
      expect(score.reference.citation, score.id).toMatch(/\d{4}/);
      expect(score.reference.url, score.id).toMatch(/^https:\/\/doi\.org\//);
    }
  });

  it('keeps the published maximum totals', () => {
    expect(scoreMaxTotal(definition('qsofa'))).toBe(3);
    expect(scoreMaxTotal(definition('glasgow'))).toBe(15);
    expect(scoreMaxTotal(definition('curb65'))).toBe(5);
    expect(scoreMaxTotal(definition('wells-pe'))).toBe(12.5);
    expect(scoreMaxTotal(definition('padua'))).toBe(20);
    expect(scoreMaxTotal(definition('cha2ds2vasc'))).toBe(9);
    expect(reachableScoreTotals(definition('wells-pe'))).toEqual(
      expect.arrayContaining([0, 1.5, 2, 6, 6.5, 12.5])
    );
  });

  it('evaluates Glasgow only when the three components are answered', () => {
    const glasgow = definition('glasgow');
    const partial = evaluateScore(glasgow, { eye: 'spontaneous' });
    expect(partial).toMatchObject({ total: 4, complete: false, band: null });
    expect(partial.missingItemIds).toEqual(['verbal', 'motor']);

    const awake = evaluateScore(glasgow, {
      eye: 'spontaneous',
      verbal: 'oriented',
      motor: 'obeys',
    });
    expect(awake).toMatchObject({ total: 15, maxTotal: 15, complete: true });
    expect(awake.band?.label).toBe('Leve');

    const coma = evaluateScore(glasgow, { eye: 'none', verbal: 'none', motor: 'none' });
    expect(coma.total).toBe(3);
    expect(coma.band?.label).toBe('Grave');
    expect(
      evaluateScore(glasgow, { eye: 'voice', verbal: 'confused', motor: 'withdraws' }).band?.label
    ).toBe('Moderado');
  });

  it('interprets the boolean scores at their published cut-offs', () => {
    expect(evaluateScore(definition('qsofa'), { rr: true, sbp: true }).band?.label).toBe(
      'Alto riesgo'
    );
    expect(evaluateScore(definition('qsofa'), { rr: true }).band?.label).toBe('Bajo riesgo');
    expect(evaluateScore(definition('qsofa'), {}).band?.label).toBe('Bajo riesgo');

    expect(
      evaluateScore(definition('curb65'), { confusion: true, urea: true, age: true }).band?.label
    ).toBe('Alto riesgo');
    expect(evaluateScore(definition('curb65'), { confusion: true, age: true }).band?.label).toBe(
      'Riesgo intermedio'
    );

    const wells = definition('wells-pe');
    expect(evaluateScore(wells, { dvt: true, alternative: true, hr: true }).total).toBe(7.5);
    expect(evaluateScore(wells, { dvt: true, alternative: true, hr: true }).band?.label).toBe(
      'Probabilidad alta'
    );
    expect(evaluateScore(wells, { hr: true }).band?.label).toBe('Probabilidad baja');
    expect(evaluateScore(wells, { hr: true, previous: true }).band?.label).toBe(
      'Probabilidad intermedia'
    );

    expect(evaluateScore(definition('padua'), { cancer: true, age: true }).band?.label).toBe(
      'Alto riesgo'
    );
    expect(evaluateScore(definition('padua'), { cancer: true }).band?.label).toBe('Bajo riesgo');
  });

  it('scores CHA2DS2-VASc with the age choice and the female modifier note', () => {
    const cha = definition('cha2ds2vasc');
    const everything = evaluateScore(cha, {
      chf: true,
      htn: true,
      age: '75plus',
      diabetes: true,
      stroke: true,
      vascular: true,
      female: true,
    });
    expect(everything.total).toBe(9);
    expect(everything.band?.label).toBe('Riesgo alto');
    expect(evaluateScore(cha, { age: 'under65', female: true }).band?.label).toBe(
      'Riesgo intermedio'
    );
    expect(evaluateScore(cha, { age: 'under65' }).band?.label).toBe('Riesgo bajo');
    expect(evaluateScore(cha, {}).complete).toBe(false);
    expect(cha.notes?.[0]).toMatch(/sexo femenino/i);
    expect(findScoreBand(cha.bands, 4)?.tone).toBe('danger');
    expect(findScoreBand(cha.bands, -1)).toBeNull();
  });
});
