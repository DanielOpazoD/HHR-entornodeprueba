// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildSchemaEvolutionLedgerSummary,
  getSchemaEvolutionLedger,
} from '@/services/repositories/migrationLedger';

describe('migrationLedger', () => {
  it('builds a stable summary from the schema evolution ledger', () => {
    const ledger = getSchemaEvolutionLedger();
    const summary = buildSchemaEvolutionLedgerSummary();

    expect(summary.totalSteps).toBe(ledger.length);
    expect(summary.firstVersion).toBe(ledger[0]?.fromVersion ?? 0);
    expect(summary.currentVersion).toBe(ledger.at(-1)?.toVersion ?? 0);
    expect(summary.labels).toEqual(ledger.map(step => step.label));
  });
});
