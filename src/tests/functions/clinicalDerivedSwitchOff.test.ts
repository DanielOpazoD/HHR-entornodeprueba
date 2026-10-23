import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  POLICY_PATH,
  PRIOR_DAY,
  RUN_ID,
  SPLIT_ENV,
  batchApi,
  checkpoint,
  createFakeFirestore,
  dayPath,
  guardedPatch,
  makeContext,
  makeDay,
  shadowPolicy,
  store,
  vitals,
  writeApi,
} from './clinicalDerivedServer.test-support';

const NEW_VITALS = [vitals('2026-11-02', 72)];
// Unset, not a strict date, or a start after the target day: the split stays off for DAY.
const OFF_VALUES = [
  undefined,
  '',
  'true',
  '2026-11-1',
  '2026-02-30',
  '2026-13-01',
  ' 2026-11-01',
  '2026-11-01T00:00:00Z',
  '2026-11-03',
];

const setEnv = (value: string | undefined) => {
  vi.unstubAllEnvs();
  vi.stubEnv(SPLIT_ENV, value);
};

const withoutTimings = (response: unknown): unknown => {
  if (Array.isArray(response)) return response.map(withoutTimings);
  if (!response || typeof response !== 'object') return response;
  const {
    serverTimingsMs: _server,
    transactionTimingsMs: _transaction,
    ...rest
  } = response as Record<string, unknown>;
  return rest;
};

/** Stored documents, the operation log and the response, without timings or telemetry. */
const outcome = (fake: ReturnType<typeof createFakeFirestore>, response: unknown) => ({
  response: withoutTimings(response),
  docs: [...fake.docs.entries()].filter(([path]) => !path.includes('/functionsTelemetry/')),
  log: fake.log,
});

const runPatch = async () => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, shadowPolicy);
  fake.seed(dayPath(), makeDay());
  const response = await writeApi(
    fake,
    'nurse_hospital',
    false
  ).patchDailyRecordWithClinicalAuthority.run(
    guardedPatch(
      {
        'beds.R2.vitalSignsHistory': NEW_VITALS,
        'beds.R2.clinicalSyncCheckpoint': checkpoint('p-2'),
      },
      { clientRuntimeContractVersion: undefined }
    ),
    makeContext()
  );
  return { fake, response };
};

const runBatch = async () => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, { ...shadowPolicy, clinicalBatchMode: 'enforced' });
  fake.seed(
    dayPath(),
    makeDay({
      rayenSyncHistory: [
        {
          id: RUN_ID,
          status: 'applied',
          sourceDate: DAY,
          policy: { mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' },
        },
      ],
    })
  );
  const response = await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(
    {
      date: DAY,
      authorityDate: DAY,
      runId: RUN_ID,
      mutationId: 'mutation-batch-1',
      expectedLastUpdated: `${DAY}T10:00:00.000Z`,
      baseRevision: 7,
      fieldContractVersion: 1,
      mode: 'enforced',
      patches: [
        {
          bedId: 'R2',
          clinicalEpisodeId: 'ep_pasaporte_2',
          fields: { vitalSignsHistory: NEW_VITALS },
        },
      ],
      checkpoints: [
        { bedId: 'R1', clinicalEpisodeId: 'ep_madre_1', checkpoint: checkpoint('m-2') },
      ],
    },
    makeContext()
  );
  return { fake, response };
};

const runSaves = async () => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, shadowPolicy);
  const prior = makeDay({ date: PRIOR_DAY, lastUpdated: `${PRIOR_DAY}T10:00:00.000Z` });
  fake.seed(dayPath(PRIOR_DAY), prior);
  const api = writeApi(fake, 'admin', false);
  const created = makeDay();
  (created.beds as Record<string, Record<string, unknown>>).R2.clinicalCarryover = {
    sourceDate: PRIOR_DAY,
  };
  const creation = await api.saveDailyRecordWithClinicalAuthority.run(
    { date: DAY, mode: 'shadow', record: created },
    makeContext()
  );
  const update = await api.saveDailyRecordWithClinicalAuthority.run(
    { date: PRIOR_DAY, mode: 'shadow', record: prior },
    makeContext()
  );
  return { fake, response: [creation, update] };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('clinicalDerived switch (D5)', () => {
  it.each(OFF_VALUES.slice(0, -1))('stays off for %j', value => {
    setEnv(value);
    expect(store.readClinicalDerivedSplitFrom()).toBeNull();
    expect(store.isClinicalDerivedSplitDate(DAY)).toBe(false);
  });

  it('turns on only for target dates on or after a strict start, read on every call', () => {
    setEnv(PRIOR_DAY);
    expect(store.readClinicalDerivedSplitFrom()).toBe(PRIOR_DAY);
    expect(store.isClinicalDerivedSplitDate('2026-10-31')).toBe(false);
    expect(store.isClinicalDerivedSplitDate(PRIOR_DAY)).toBe(true);
    expect(store.isClinicalDerivedSplitDate(DAY)).toBe(true);
    expect(store.isClinicalDerivedSplitDate('2026-11-2')).toBe(false);
    setEnv('2026-11-03');
    expect(store.isClinicalDerivedSplitDate(DAY)).toBe(false);
  });
});

describe('every callable behaves as before while the switch is off and no day is marked', () => {
  it.each([
    ['guarded patch', runPatch],
    ['clinical batch', runBatch],
    ['full saves (creation with carryover, then an update)', runSaves],
  ])(
    '%s: no clinicalDerived access, no marker, same result for every off value',
    async (_l, run) => {
      setEnv(undefined);
      const baseline = await run();
      expect(baseline.fake.touched('/clinicalDerived/')).toEqual([]);
      for (const [path, data] of baseline.fake.docs) {
        expect(data, path).not.toHaveProperty('clinicalDerivedLayout');
        expect(data, path).not.toHaveProperty('clinicalDerivedPrevious');
      }
      for (const telemetry of baseline.fake.telemetry()) {
        expect(
          Object.keys(telemetry.context).filter(key => key.startsWith('clinicalDerived'))
        ).toEqual([]);
      }

      for (const value of OFF_VALUES.slice(1)) {
        setEnv(value);
        const other = await run();
        expect(outcome(other.fake, other.response), String(value)).toEqual(
          outcome(baseline.fake, baseline.response)
        );
      }
    }
  );

  it('guarded patch: the moved fields stay embedded in the day and in the response', async () => {
    setEnv(undefined);
    const { fake, response } = await runPatch();
    const day = fake.read(dayPath()) as { beds: Record<string, Record<string, unknown>> };
    expect(day.beds.R2.vitalSignsHistory).toEqual(NEW_VITALS);
    expect(day.beds.R2.clinicalSyncCheckpoint).toEqual(checkpoint('p-2'));
    expect(response.recordState.record.beds.R2.vitalSignsHistory).toEqual(NEW_VITALS);
    expect(fake.read(`${dayPath()}/history/rayen-${RUN_ID}`)).not.toHaveProperty(
      'clinicalDerivedPrevious'
    );
  });

  it('clinical batch: v1 is still accepted and the history copy keeps the plain snapshot', async () => {
    setEnv(undefined);
    const { fake, response } = await runBatch();
    expect(response).toMatchObject({ authorityStatus: 'ok', historySnapshots: 1 });
    const day = fake.read(dayPath()) as { beds: Record<string, Record<string, unknown>> };
    expect(day.beds.R2.vitalSignsHistory).toEqual(NEW_VITALS);
    expect(day.beds.R1.clinicalSyncCheckpoint).toEqual(checkpoint('m-2'));
  });
});
