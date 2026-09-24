import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSpecialtyJevFunctions } = require('../../../functions/lib/specialtyJevFunctions.js');
const { OPTIONS } = require('../../../functions/lib/specialtyJevAdapter.js');
const firestoreIndexes = require('../../../firestore.indexes.json');
const currentRapaNuiDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${calendar.year}-${calendar.month}-${calendar.day}`;
};
const policy = {
  schemaVersion: 1,
  revision: 1,
  autoEnabled: false,
  memoryEnabled: false,
  aiMode: 'consultative',
  rules: [],
  memory: [],
  aiMonthlyLimit: 3,
  diagnosisLabels: { 'J18.9': 'Neumonía sintética' },
  aiRubrics: Object.fromEntries(
    OPTIONS.map((key: string) => [key, `Criterio sintético aprobado para ${key}.`])
  ),
};
const result = {
  model: 'jev-1.13.0',
  answers: {
    specialty: {
      type: 'choice',
      choice: 'internal_medicine',
      confidence: 0.8,
      probabilities: Object.fromEntries(
        OPTIONS.map((key: string) => [key, key === 'internal_medicine' ? 1 : 0])
      ),
    },
  },
};

const harness = () => {
  const date = currentRapaNuiDate();
  const docs = new Map<string, Record<string, unknown>>([
    [
      `dailyRecords/${date}`,
      {
        date,
        beds: { R1: { clinicalEpisodeId: 'synthetic-episode', specialty: '', cie10Code: 'J18.9' } },
      },
    ],
    ['specialtyPolicies/active', policy],
  ]);
  const firestore = {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({ doc: (id: string) => ({ key: `${name}/${id}` }) }),
      }),
    }),
    runTransaction: async (callback: (transaction: object) => Promise<unknown>) =>
      callback({
        get: async (reference: { key: string }) => ({
          exists: docs.has(reference.key),
          data: () => docs.get(reference.key),
        }),
        set: (reference: { key: string }, value: Record<string, unknown>) =>
          docs.set(reference.key, value),
        update: (reference: { key: string }, value: Record<string, unknown>) =>
          docs.set(reference.key, { ...docs.get(reference.key), ...value }),
      }),
  };
  const context = { auth: { uid: 'synthetic-user', token: { email: 'synthetic@example.test' } } };
  const callable = createSpecialtyJevFunctions({
    firestore,
    resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
  }).requestSpecialtyJevSuggestion;
  const input = {
    date,
    bedId: 'R1',
    target: 'bed',
    episodeId: 'synthetic-episode',
    requestId: 'synthetic-request-001',
  };
  return { docs, callable, context, input, date };
};

describe('consultative Jev callable with synthetic provider responses', () => {
  afterEach(() => {
    delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
    delete process.env.HHR_JEV_CLINICAL_APPROVED;
    delete process.env.TYPESAFE_API_KEY;
    vi.unstubAllGlobals();
  });

  it('binds the API key only to the Jev callable through Secret Manager', () => {
    const { callable } = harness();
    expect(callable.__endpoint.secretEnvironmentVariables).toEqual([{ key: 'TYPESAFE_API_KEY' }]);
  });

  it('stays disabled without explicit clinical approval', async () => {
    const { callable, input, context } = harness();
    await expect(callable.run(input, context)).rejects.toThrow(/disabled/i);
  });

  it('returns a suggestion without writing the patient and invalidates a late episode', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    process.env.TYPESAFE_API_KEY = 'test';
    const { callable, input, context, docs, date } = harness();
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      body: null,
      text: async () => JSON.stringify(result),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const answer = await callable.run(input, context);
    expect(answer).toMatchObject({ status: 'complete', result: { specialty: 'Med Interna' } });
    expect(docs.get(`dailyRecords/${date}`)?.beds).toEqual({
      R1: {
        clinicalEpisodeId: 'synthetic-episode',
        specialty: '',
        cie10Code: 'J18.9',
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestDoc = docs.get('specialtyAiRequests/synthetic-request-001')!;
    expect(requestDoc.expireAt).toBeInstanceOf(Date);
    expect((requestDoc.expireAt as Date).getTime()).toBe(
      Date.parse(requestDoc.expiresAt as string)
    );
    expect(firestoreIndexes.fieldOverrides).toContainEqual({
      collectionGroup: 'specialtyAiRequests',
      fieldPath: 'expireAt',
      ttl: true,
      indexes: [],
    });

    const late = harness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        late.docs.set(`dailyRecords/${late.date}`, {
          date: late.date,
          beds: { R1: { clinicalEpisodeId: 'new-episode', specialty: '', cie10Code: 'J18.9' } },
        });
        return { ok: true, body: null, text: async () => JSON.stringify(result) };
      })
    );
    expect(await late.callable.run(late.input, late.context)).toEqual({ status: 'obsolete' });
    expect(late.docs.get('specialtyAiRequests/synthetic-request-001')?.status).toBe('obsolete');
  });

  it('retries an expired pending reservation once and then finalizes it', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    process.env.TYPESAFE_API_KEY = 'test';
    const { callable, input, context, docs } = harness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({
        ok: true,
        body: null,
        text: async () => JSON.stringify(result),
      }))
    );
    expect(await callable.run(input, context)).toMatchObject({ status: 'complete' });
    const existing = docs.get('specialtyAiRequests/synthetic-request-001')!;
    docs.set('specialtyAiRequests/synthetic-request-001', {
      ...existing,
      status: 'pending',
      result: undefined,
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
      attempt: 1,
    });
    expect(await callable.run(input, context)).toMatchObject({ status: 'complete' });
    expect(docs.get('specialtyAiUsage/' + input.date.slice(0, 7))?.count).toBe(1);
    const retried = docs.get('specialtyAiRequests/synthetic-request-001')!;
    docs.set('specialtyAiRequests/synthetic-request-001', {
      ...retried,
      status: 'pending',
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await callable.run(input, context)).toEqual({ status: 'unavailable' });
    expect(docs.get('specialtyAiRequests/synthetic-request-001')?.status).toBe('failed');
  });

  it('keeps an ambiguous provider failure on the same reserved ID and quota', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    process.env.TYPESAFE_API_KEY = 'test';
    const { callable, input, context, docs } = harness();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic timeout'))
      .mockResolvedValue({ ok: true, body: null, text: async () => JSON.stringify(result) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await callable.run(input, context)).toEqual({ status: 'pending' });
    expect(docs.get('specialtyAiRequests/synthetic-request-001')?.status).toBe('pending');
    expect(await callable.run(input, context)).toEqual({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledOnce();

    const pending = docs.get('specialtyAiRequests/synthetic-request-001')!;
    docs.set('specialtyAiRequests/synthetic-request-001', {
      ...pending,
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await callable.run(input, context)).toMatchObject({ status: 'complete' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(docs.get('specialtyAiUsage/' + input.date.slice(0, 7))?.count).toBe(1);
  });

  it('does not publish a provider result after its acceptance window expires', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    process.env.TYPESAFE_API_KEY = 'test';
    const { callable, input, context, docs } = harness();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      const key = 'specialtyAiRequests/synthetic-request-001';
      docs.set(key, { ...docs.get(key), expiresAt: new Date(Date.now() - 1000).toISOString() });
      return { ok: true, body: null, text: async () => JSON.stringify(result) };
    }));

    expect(await callable.run(input, context)).toEqual({ status: 'failed' });
    expect(docs.get('specialtyAiRequests/synthetic-request-001')).toMatchObject({
      status: 'failed', errorCode: 'JEV_EXPIRED',
    });
    expect(docs.get('specialtyAiRequests/synthetic-request-001')?.result).toBeUndefined();
  });

  it('does not retry a pending request with less than one provider deadline remaining', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    process.env.TYPESAFE_API_KEY = 'test';
    const { callable, input, context, docs } = harness();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, body: null, text: async () => JSON.stringify(result),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callable.run(input, context);
    const key = 'specialtyAiRequests/synthetic-request-001';
    docs.set(key, { ...docs.get(key), status: 'pending', result: undefined, attempt: 1,
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString() });

    expect(await callable.run(input, context)).toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(docs.get(key)).toMatchObject({ status: 'failed', errorCode: 'JEV_EXPIRED' });
  });
});
