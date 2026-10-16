import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const {
  createSpecialtyPolicyFunctions,
} = require('../../../functions/lib/specialtyPolicyFunctions.js');
const { applyPendingSpecialtyRules } = require('../../../functions/lib/specialtyRules.js');
const date = '2026-10-16';
const policyKey = 'specialtyPolicies/active';
const recordKey = `dailyRecords/${date}`;
const rule = {
  id: 'pneumonia',
  kind: 'assign',
  cie10Code: 'J18.9',
  specialty: 'Med Interna',
  scope: 'all',
  revision: 1,
};
const policy = {
  schemaVersion: 1,
  revision: 1,
  autoEnabled: true,
  memoryEnabled: false,
  aiMode: 'off',
  rules: [rule],
  memory: [],
};
const patient = (id: string) => ({
  patientName: `Sintético ${id}`,
  clinicalEpisodeId: id,
  cie10Code: 'J18.9',
  specialty: '',
});
const record = () => ({
  date,
  beds: {
    R1: patient('episode-one'),
    R2: { ...patient('episode-two'), specialty: 'Cirugía' },
    R3: { ...patient('episode-empty'), patientName: '' },
    R4: { ...patient('episode-blocked'), isBlocked: true },
    R5: {
      ...patient('episode-parent'),
      cie10Code: 'K35.8',
      clinicalCrib: { ...patient('episode-crib'), bedMode: 'Cuna' },
    },
  },
  meta: { revision: 5 },
  lastUpdated: 'synthetic-before',
});
type Ref = { key: string; collection: (name: string) => { doc: (id: string) => Ref } };
const ref = (key: string): Ref => ({
  key,
  collection: name => ({ doc: id => ref(`${key}/${name}/${id}`) }),
});
const fixture = () => {
  const docs = new Map<string, Record<string, unknown>>([
    ['settings/rayenImportPolicy', { schemaVersion: 2 }],
    [policyKey, policy],
    [recordKey, record()],
  ]);
  const firestore = {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      }),
    }),
    runTransaction: async (callback: (transaction: object) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, unknown>]> = [];
      const result = await callback({
        get: async (reference: Ref) => {
          if (writes.length) throw new Error('Read after transaction write');
          return { exists: docs.has(reference.key), data: () => docs.get(reference.key) };
        },
        set: (reference: Ref, value: Record<string, unknown>) => {
          writes.push([reference.key, value]);
        },
      });
      writes.forEach(([key, value]) => docs.set(key, value));
      return result;
    },
  };
  const callable = createSpecialtyPolicyFunctions({
    firestore,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  }).configureSpecialtyPolicy;
  const input = {
    confirmed: true,
    expectedRevision: 1,
    autoEnabled: true,
    memoryEnabled: false,
    aiMode: 'off',
    rules: [rule],
    memory: [],
    applyDate: date,
  };
  const context = { auth: { uid: 'synthetic-admin', token: { email: 'admin@example.test' } } };
  return { docs, input, run: (data = input) => callable.run(data, context) };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${date}T12:00:00Z`));
  process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
});

describe('publishing persistent automatic specialty rules', () => {
  it('atomically saves the policy, assigns pending episodes and writes server audits', async () => {
    const { docs, run } = fixture();
    expect(await run()).toMatchObject({
      revision: 2,
      appliedDecisions: 2,
      applicationStatus: 'applied',
    });
    const saved = docs.get(recordKey) as ReturnType<typeof record>;
    expect(saved.beds.R1.specialty).toBe('Med Interna');
    expect(saved.beds.R2.specialty).toBe('Cirugía');
    expect(saved.beds.R3.specialty).toBe('');
    expect(saved.beds.R4.specialty).toBe('');
    expect(saved.beds.R5.clinicalCrib.specialty).toBe('Pediatría');
    expect(saved.beds.R3).not.toHaveProperty('isBlocked');
    expect(saved.meta.revision).toBe(6);
    const audits = [...docs.entries()].filter(([key]) => key.includes('/specialtyDecisions/'));
    expect(audits).toHaveLength(2);
    expect(audits[0][1]).toMatchObject({
      source: 'rule',
      catalogRevision: 2,
      actorUid: 'synthetic-admin',
    });
  });
  it('keeps an occupied clinical crib eligible when the main patient slot is empty', async () => {
    const { docs, run } = fixture();
    docs.set(recordKey, {
      ...record(),
      beds: {
        R1: {
          ...patient('empty-parent-slot'),
          patientName: '',
          clinicalCrib: { ...patient('occupied-crib'), bedMode: 'Cuna' },
        },
      },
    });
    expect(await run()).toMatchObject({ appliedDecisions: 1, applicationStatus: 'applied' });
    expect(docs.get(recordKey)).toMatchObject({
      beds: {
        R1: {
          patientName: '',
          specialty: '',
          clinicalCrib: { specialty: 'Pediatría' },
        },
      },
    });
    const beds = docs.get(recordKey)?.beds as { R1: object };
    expect(beds.R1).not.toHaveProperty('isBlocked');
    expect([...docs.keys()].filter(key => key.includes('/specialtyDecisions/'))).toHaveLength(1);
  });

  it('normalizes and collapses equivalent diagnoses, rejecting conflicting duplicates atomically', async () => {
    const { docs, input, run } = fixture();
    await expect(
      run({
        ...input,
        rules: [rule, { ...rule, id: 'second', cie10Code: ' j18.9 ', specialty: 'Cirugía' }],
      })
    ).rejects.toThrow(/conflicting duplicate/i);
    expect(docs.get(policyKey)?.revision).toBe(1);
    expect(docs.get(recordKey)?.meta).toEqual({ revision: 5 });
    await run({ ...input, rules: [rule, { ...rule, id: 'second', cie10Code: ' j18.9 ' }] });
    expect(docs.get(policyKey)?.rules).toEqual([rule]);
  });
  it('does not repeat decisions after another publication or accept a stale revision', async () => {
    const { docs, input, run } = fixture();
    await run();
    await expect(run()).rejects.toThrow(/catalog changed/i);
    expect(await run({ ...input, expectedRevision: 2 })).toMatchObject({ appliedDecisions: 0 });
    expect(docs.get(recordKey)?.meta).toMatchObject({ revision: 6 });
    expect([...docs.keys()].filter(key => key.includes('/specialtyDecisions/'))).toHaveLength(2);
  });
  it('keeps active rules without expiry for future censuses until explicitly disabled', async () => {
    const { docs, run } = fixture();
    await run();
    const persistedPolicy = docs.get(policyKey);
    vi.setSystemTime(new Date('2027-04-16T12:00:00Z'));
    const future = { date: '2027-04-16', beds: { R1: patient('future-episode') } };
    expect(
      applyPendingSpecialtyRules({
        remoteRecord: future,
        candidate: future,
        policy: persistedPolicy,
        actorUid: 'synthetic-user',
        mutationId: 'future-sync',
        now: new Date().toISOString(),
      })
    ).toHaveLength(1);
    expect(future.beds.R1.specialty).toBe('Med Interna');
    const disabled = { date: '2027-04-17', beds: { R1: patient('another-future') } };
    expect(
      applyPendingSpecialtyRules({
        remoteRecord: disabled,
        candidate: disabled,
        policy: { ...persistedPolicy, autoEnabled: false },
        actorUid: 'synthetic-user',
        mutationId: 'disabled-sync',
        now: new Date().toISOString(),
      })
    ).toEqual([]);
    expect(disabled.beds.R1.specialty).toBe('');
  });
  it('saves rules before the new day exists but never applies them to a historical census', async () => {
    const { docs, run, input } = fixture();
    docs.delete(recordKey);
    expect(await run()).toMatchObject({ applicationStatus: 'record_missing', revision: 2 });
    await expect(run({ ...input, expectedRevision: 2, applyDate: '2026-10-15' })).rejects.toThrow(
      /current census/i
    );
    expect(docs.get(policyKey)?.revision).toBe(2);
  });
  it('does not change any confirmed decision, including an intentional blank specialty', async () => {
    const { docs, run } = fixture();
    const metadata = {
      schemaVersion: 3,
      episodeId: 'confirmed-blank',
      decisionId: 'manual-blank',
      recordDate: date,
      source: 'manual',
      actorUid: 'synthetic-admin',
      decidedAt: new Date().toISOString(),
    };
    const confirmed = { ...patient('confirmed-blank'), specialtyAssignment: metadata };
    docs.set(recordKey, { ...record(), beds: { R1: confirmed } });
    docs.set(`${recordKey}/specialtyDecisions/manual-blank`, {
      recordDate: date,
      decisionId: 'manual-blank',
      episodeId: 'confirmed-blank',
      value: '',
      metadata,
    });
    expect(await run()).toMatchObject({ appliedDecisions: 0 });
    expect((docs.get(recordKey)?.beds as { R1: object }).R1).toEqual(confirmed);
  });
});
