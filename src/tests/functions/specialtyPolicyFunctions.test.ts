import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSpecialtyPolicyFunctions } = require('../../../functions/lib/specialtyPolicyFunctions.js');
const currentRapaNuiDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Easter',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${calendar.year}-${calendar.month}-${calendar.day}`;
};

describe('explicit specialty memory publication', () => {
  afterEach(() => { delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT; });

  it('publishes only a confirmed current manual decision with matching diagnosis and revision', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const date = currentRapaNuiDate();
    const metadata = { schemaVersion: 3, episodeId: 'synthetic-episode',
      decisionId: 'manual-decision', recordDate: date, source: 'manual',
      actorUid: 'synthetic-admin', decidedAt: new Date().toISOString() };
    const docs = new Map<string, Record<string, unknown>>([
      ['settings/rayenImportPolicy', { schemaVersion: 2 }],
      [`dailyRecords/${date}`, { beds: { R1: { clinicalEpisodeId: 'synthetic-episode',
        specialty: 'Cirugía', cie10Code: 'K35.8',
        specialtyAssignment: metadata } } }],
      [`dailyRecords/${date}/specialtyDecisions/manual-decision`, {
        recordDate: date, decisionId: 'manual-decision', episodeId: 'synthetic-episode',
        value: 'Cirugía', metadata }],
    ]);
    type Ref = { key: string; collection: (name: string) => { doc: (id: string) => Ref } };
    const ref = (key: string): Ref => ({ key,
      collection: (name: string) => ({ doc: (id: string) => ref(`${key}/${name}/${id}`) }) });
    const firestore = { collection: () => ({ doc: () => ({
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    }) }),
    runTransaction: async (callback: (transaction: object) => Promise<unknown>) => callback({
      get: async (reference: { key: string }) => ({
        exists: docs.has(reference.key), data: () => docs.get(reference.key),
      }),
      set: (reference: { key: string }, value: Record<string, unknown>) =>
        docs.set(reference.key, value),
    }) };
    const callable = createSpecialtyPolicyFunctions({ firestore,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin') }).publishSpecialtyMemory;
    const context = { auth: { uid: 'synthetic-admin', token: { email: 'admin@example.test' } } };
    const input = { confirmed: true, date, bedId: 'R1', target: 'bed',
      episodeId: 'synthetic-episode', specialty: 'Cirugía',
      expectedDecisionId: 'manual-decision', expectedCie10Code: 'K35.8',
      expectedRevision: 0 };
    await expect(callable.run({ ...input, expectedCie10Code: 'J18.9' }, context))
      .rejects.toThrow(/diagnosis changed/i);
    expect(docs.has('settings/specialtyAssignment')).toBe(false);
    expect(await callable.run(input, context)).toMatchObject({ status: 'published', revision: 1 });
    expect((docs.get('settings/specialtyAssignment')?.memory as Array<object>))
      .toEqual([expect.objectContaining({ cie10Code: 'K35.8', specialty: 'Cirugía' })]);
    expect(await callable.run({ ...input, expectedRevision: 1 }, context))
      .toMatchObject({ status: 'already_published', revision: 1 });
    await expect(callable.run({ ...input, expectedRevision: 0 }, context))
      .rejects.toThrow(/catalog changed/i);
  });

  it('atomically replaces, corrects and removes rules under revision CAS', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const docs = new Map<string, Record<string, unknown>>([
      ['settings/rayenImportPolicy', { schemaVersion: 2 }],
    ]);
    const firestore = { collection: () => ({ doc: () => ({
      collection: (name: string) => ({ doc: (id: string) => ({ key: `${name}/${id}` }) }),
    }) }),
    runTransaction: async (callback: (transaction: object) => Promise<unknown>) => callback({
      get: async (reference: { key: string }) => ({
        exists: docs.has(reference.key), data: () => docs.get(reference.key),
      }),
      set: (reference: { key: string }, value: Record<string, unknown>) =>
        docs.set(reference.key, value),
    }) };
    const callable = createSpecialtyPolicyFunctions({ firestore,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin') }).configureSpecialtyPolicy;
    const context = { auth: { uid: 'synthetic-admin', token: { email: 'admin@example.test' } } };
    const base = { confirmed: true, autoEnabled: false, memoryEnabled: false,
      aiMode: 'off' };
    const rule = { id: 'synthetic-rule', kind: 'assign', cie10Code: 'J18.9',
      specialty: 'Med Interna', scope: 'all', revision: 1 };
    expect(await callable.run({ ...base, expectedRevision: 0, rules: [rule] }, context))
      .toMatchObject({ revision: 1, ruleCount: 1 });
    await expect(callable.run({ ...base, expectedRevision: 0, rules: [] }, context))
      .rejects.toThrow(/catalog changed/i);
    const corrected = { ...rule, specialty: 'Pediatría', revision: 2 };
    expect(await callable.run({ ...base, expectedRevision: 1, rules: [corrected] }, context))
      .toMatchObject({ revision: 2, ruleCount: 1 });
    expect((docs.get('settings/specialtyAssignment')?.rules as Array<object>))
      .toEqual([corrected]);
    expect(await callable.run({ ...base, expectedRevision: 2, rules: [] }, context))
      .toMatchObject({ revision: 3, ruleCount: 0 });
    await expect(callable.run({ ...base, expectedRevision: 3, rules: 'invalid' }, context))
      .rejects.toThrow(/replacement lists/i);
  });
});
