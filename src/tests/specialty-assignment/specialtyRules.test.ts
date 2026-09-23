import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolvePendingSpecialty, applyPendingSpecialtyRules, validatePolicy } =
  require('../../../functions/lib/specialtyRules.js');

const policy = (rules: object[] = [], memory: object[] = []) => ({
  schemaVersion: 1, revision: 3, autoEnabled: true, memoryEnabled: true,
  aiMode: 'off', rules, memory,
});
const rule = (id: string, specialty: string) =>
  ({ id, kind: 'assign', cie10Code: 'J18.9', specialty, scope: 'all', revision: 1 });
const patient = (fields: Record<string, unknown> = {}) =>
  ({ clinicalEpisodeId: 'synthetic-episode', specialty: '', cie10Code: 'J18.9', ...fields });

describe('deterministic specialty resolver', () => {
  it('assigns only an approved exact code and leaves other codes unresolved', () => {
    const config = policy([rule('base-one', 'Med Interna')]);
    expect(validatePolicy(config)).toBe(true);
    expect(resolvePendingSpecialty(patient(), config)).toMatchObject({ kind: 'assign' });
    expect(resolvePendingSpecialty(patient({ cie10Code: 'J18.1' }), config)).toMatchObject({
      kind: 'review', reason: 'no_rule',
    });
  });

  it('rejects missing and non-string rule IDs before publication', () => {
    for (const id of [undefined, null, 123, true]) {
      expect(validatePolicy(policy([{ ...rule('base-one', 'Med Interna'), id }]))).toBe(false);
    }
  });

  it('protects manual, legacy and empty manual values before applying any rule', () => {
    const config = policy([rule('base-one', 'Med Interna')]);
    expect(resolvePendingSpecialty(patient({ specialty: 'Cirugía' }), config).kind).toBe('keep');
    expect(resolvePendingSpecialty(patient({ isBlocked: true }), config).kind).toBe('keep');
    expect(resolvePendingSpecialty(patient({ specialtyAssignment: { source: 'manual' } }), config).kind)
      .toBe('keep');
    expect(resolvePendingSpecialty(patient({ clinicalEpisodeId: '' }), config).kind).toBe('review');
  });

  it('lets manual-required win, memory precede base and conflicts force review', () => {
    const base = rule('base-one', 'Med Interna');
    const remembered = rule('remembered', 'Cirugía');
    expect(resolvePendingSpecialty(patient(), policy([base], [remembered])).rule.specialty)
      .toBe('Cirugía');
    expect(resolvePendingSpecialty(patient(), policy([
      base, { id: 'hard-review', kind: 'review', cie10Code: 'J18.9', scope: 'all', revision: 1 },
    ], [remembered])).kind).toBe('review');
    expect(resolvePendingSpecialty(patient(), policy([], [base, remembered])).reason)
      .toBe('rule_conflict');
  });

  it('writes an automatic decision only for a pending episode, separate from its crib', () => {
    const record = { date: '2026-09-23', beds: { R1: { ...patient(),
      clinicalCrib: patient({ clinicalEpisodeId: 'crib-episode' }) } } };
    const events = applyPendingSpecialtyRules({ remoteRecord: { beds: {} }, candidate: record,
      policy: policy([rule('base-one', 'Med Interna')]), actorUid: 'synthetic-user',
      mutationId: 'synthetic-mutation', now: '2026-09-23T00:00:00.000Z' });
    expect(events).toHaveLength(2);
    expect(events[0].decisionId).not.toBe(events[1].decisionId);
    expect((record.beds.R1 as Record<string, unknown>).specialtyAssignment).toMatchObject({ source: 'rule' });
    expect((record.beds.R1.clinicalCrib as Record<string, unknown>).specialtyAssignment).toMatchObject({ source: 'rule' });
  });
});
