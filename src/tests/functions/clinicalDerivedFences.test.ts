import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  FieldValue,
  POLICY_PATH,
  PRIOR_DAY,
  RUN_ID,
  SPLIT_ENV,
  batchApi,
  checkpoint,
  createFakeFirestore,
  dayPath,
  episodeDoc,
  episodePath,
  guardedPatch,
  makeContext,
  makeDay,
  marker,
  shadowPolicy,
  store,
  vitals,
  writeApi,
} from './clinicalDerivedServer.test-support';

/*
 * Where the split-day fences sit (D7, D13) and what functionsTelemetry says about them: a request
 * that writes nothing is never fenced, an unknown marker always fails closed, each rejection keeps
 * a closed reason, and parity v3 is reported only where parity sees the split layout.
 */

type Fake = ReturnType<typeof createFakeFirestore>;
type Mode = 'shadow' | 'enforced';
type Holder = Record<string, unknown>;

const runEvent = (mode: Mode) => ({
  id: RUN_ID,
  status: 'applied',
  sourceDate: DAY,
  policy: { mode: 'preview', revision: 4, clinicalBatchMode: mode },
});

/** R2 already split: its moved fields live only in its document. `layout: null` leaves no marker. */
const setupSplit = ({ mode = 'enforced' as Mode, layout = marker() as unknown } = {}) => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, { ...shadowPolicy, clinicalBatchMode: mode });
  const day = makeDay({
    ...(layout === null ? {} : { clinicalDerivedLayout: layout }),
    rayenSyncHistory: [runEvent(mode)],
  });
  const r2 = (day.beds as Record<string, Holder>).R2;
  delete r2.vitalSignsHistory;
  delete r2.clinicalSyncCheckpoint;
  fake.seed(dayPath(), day);
  fake.seed(
    episodePath('ep_pasaporte_2'),
    episodeDoc('ep_pasaporte_2', {
      vitalSignsHistory: [vitals('2026-11-01', 66)],
      clinicalSyncCheckpoint: checkpoint('p-doc'),
    })
  );
  return fake;
};

const batch = (overrides: Record<string, unknown> = {}) => ({
  date: DAY,
  authorityDate: DAY,
  runId: RUN_ID,
  mutationId: 'mutation-batch-1',
  expectedLastUpdated: `${DAY}T10:00:00.000Z`,
  baseRevision: 7,
  fieldContractVersion: 2,
  mode: 'enforced',
  patches: [
    {
      bedId: 'R2',
      clinicalEpisodeId: 'ep_pasaporte_2',
      fields: { vitalSignsHistory: [vitals(DAY, 72)] },
    },
  ],
  checkpoints: [],
  clientRuntimeContractVersion: 3,
  ...overrides,
});

const writes = (fake: Fake) => fake.log.filter(entry => entry.op !== 'get');
const lastTelemetry = (fake: Fake) => fake.telemetry().at(-1)?.context as Holder;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('split-day fences of the clinical batch', () => {
  it('answers an older client idempotently when the combined view already holds its batch', async () => {
    const fake = setupSplit();
    const request = batch({
      mutationId: 'mutation-receipt-evicted',
      patches: [
        {
          bedId: 'R2',
          clinicalEpisodeId: 'ep_pasaporte_2',
          fields: { vitalSignsHistory: [vitals('2026-11-01', 66)] },
        },
      ],
      clientRuntimeContractVersion: undefined,
    });

    const response = await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(
      request,
      makeContext()
    );

    expect(response).toMatchObject({ authorityStatus: 'idempotent', patientWrites: 0 });
    expect(writes(fake)).toEqual([]);
  });

  it.each([
    ['client_outdated', { clientRuntimeContractVersion: 2 }],
    ['field_contract_unsupported', { fieldContractVersion: 1 }],
  ])('records the closed rejection reason %s, never the message', async (reason, overrides) => {
    const fake = setupSplit();

    await expect(
      batchApi(fake).applyRayenClinicalEnrichmentBatch.run(batch(overrides), makeContext())
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(writes(fake)).toEqual([]);
    const context = lastTelemetry(fake);
    expect(context).toMatchObject({
      clinicalDerivedRejection: reason,
      parityContractVersion: 3,
      authorityStatus: 'blocked',
    });
    expect(JSON.stringify(context)).not.toMatch(/reload|canonical field contract/);
  });

  it.each([
    ['a write', batch()],
    [
      'a request the day already holds',
      batch({
        patches: [
          {
            bedId: 'R1',
            clinicalEpisodeId: 'ep_madre_1',
            fields: { vitalSignsHistory: [vitals('2026-11-01', 80)] },
          },
        ],
      }),
    ],
  ])('fails closed on a marker it does not understand (%s)', async (_label, request) => {
    const fake = setupSplit({ layout: { version: 2, generation: 'g-next' } });

    await expect(
      batchApi(fake).applyRayenClinicalEnrichmentBatch.run(request, makeContext())
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_layout_unsupported:/),
    });
    expect(writes(fake)).toEqual([]);
    expect(lastTelemetry(fake)).toMatchObject({ clinicalDerivedRejection: 'layout_unsupported' });
  });

  // v3 only where parity sees the split layout (D13).
  it.each([
    ['an unmarked day, switch off', 2, undefined, false, 'enforced'],
    ['an unmarked day the shadow batch would mark', 2, DAY, false, 'shadow'],
    ['an unmarked day the enforced batch marks', 3, DAY, false, 'enforced'],
    ['a marked day, switch off', 3, undefined, true, 'shadow'],
  ] as const)(
    '%s reports parity contract v%s',
    async (_label, version, switchValue, marked, mode) => {
      vi.stubEnv(SPLIT_ENV, switchValue);
      const fake = marked ? setupSplit({ mode }) : createFakeFirestore();
      if (!marked) {
        fake.seed(POLICY_PATH, { ...shadowPolicy, clinicalBatchMode: mode });
        fake.seed(dayPath(), makeDay({ rayenSyncHistory: [runEvent(mode)] }));
      }

      await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(batch({ mode }), makeContext());

      expect(lastTelemetry(fake).parityContractVersion).toBe(version);
    }
  );
});

describe('partial moved-field paths', () => {
  const partialCheckpoint = { 'beds.R2.clinicalSyncCheckpoint.sources': { vitals: {} } };

  it.each([
    ['with the Rayen write fence', shadowPolicy, /authoritative clinical batch/],
    ['without it', null, /schema-v2 server clinical authority fence/],
  ])(
    'never reach the split from an admin %s, on unmarked and split days alike',
    async (_label, policy, refusal) => {
      for (const layout of [null, marker()]) {
        const fake = setupSplit({ layout });
        if (policy) fake.seed(POLICY_PATH, policy);
        else fake.docs.delete(POLICY_PATH);

        await expect(
          writeApi(fake, 'admin').patchDailyRecordWithClinicalAuthority.run(
            {
              date: DAY,
              expectedLastUpdated: `${DAY}T10:00:00.000Z`,
              patch: partialCheckpoint,
              syncContract: { mutationId: 'm-admin', changedPaths: Object.keys(partialCheckpoint) },
              clientRuntimeContractVersion: 3,
            },
            makeContext()
          )
        ).rejects.toMatchObject({
          code: 'failed-precondition',
          message: expect.stringMatching(refusal),
        });
        expect(writes(fake)).toEqual([]);
      }
    }
  );

  it('are refused by the store itself on a split day, with their own reason', async () => {
    const transaction = { get: vi.fn() };

    await expect(
      store.createClinicalDerivedStore({ FieldValue }).preparePatchSplit({
        transaction,
        dayRef: null,
        date: DAY,
        remoteData: makeDay({ clinicalDerivedLayout: marker() }),
        patch: partialCheckpoint,
        data: { clientRuntimeContractVersion: 3 },
      })
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_partial_path_unsupported:/),
      clinicalDerivedRejection: 'partial_path_unsupported',
    });
    expect(transaction.get).not.toHaveBeenCalled();
  });
});

describe('split counters describe the attempt that answered', () => {
  /** The first attempt commits but its answer is lost, so the second one finds its receipt. */
  const retryAfterCommit = (fake: Fake) => {
    const run = fake.firestore.runTransaction;
    fake.firestore.runTransaction = async <T>(
      callback: (transaction: unknown) => Promise<T>
    ): Promise<T> => {
      await run(callback);
      return run(callback);
    };
  };

  it.each([
    [
      'guarded patch',
      (fake: Fake) =>
        writeApi(fake).patchDailyRecordWithClinicalAuthority.run(
          guardedPatch({ 'beds.R2.vitalSignsHistory': [vitals(DAY, 72)] }),
          makeContext()
        ),
    ],
    [
      'full save creating the day',
      (fake: Fake) => {
        fake.docs.delete(dayPath());
        return writeApi(fake, 'admin').saveDailyRecordWithClinicalAuthority.run(
          {
            date: DAY,
            mode: 'shadow',
            record: makeDay(),
            syncContract: { mutationId: 'mutation-save-1' },
            clientRuntimeContractVersion: 3,
          },
          makeContext()
        );
      },
    ],
  ])('%s: a receipt found on retry reports no split', async (_label, call) => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const fake = createFakeFirestore();
    fake.seed(POLICY_PATH, shadowPolicy);
    fake.seed(dayPath(), makeDay());
    retryAfterCommit(fake);

    const response = await call(fake);

    expect(response.authorityStatus).toBe('idempotent');
    expect((fake.read(dayPath()) as Holder).clinicalDerivedLayout).toBeDefined();
    const context = lastTelemetry(fake);
    expect(Object.keys(context).filter(key => key.startsWith('clinicalDerived'))).toEqual([]);
  });
});
