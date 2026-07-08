import { describe, expect, it } from 'vitest';
import { evaluateDailyRecordTruthContract } from '../../../scripts/dailyRecordTruthContractSupport.mjs';

describe('daily record truth contract support', () => {
  it('accepts the release-critical truth contract docs, tests and gate markers', () => {
    const result = evaluateDailyRecordTruthContract(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.checks.map(check => check.id)).toEqual([
      'truth-contract-adr',
      'last-write-wins-prohibited',
      'two-client-restart-contract-test',
      'conflict-recovery-ui-reasons',
      'conflict-resolution-summary-observability',
      'operator-runbook',
      'clinical-conflict-center-contract',
    ]);
    expect(result.checks.every(check => check.ok)).toBe(true);
  });
});
