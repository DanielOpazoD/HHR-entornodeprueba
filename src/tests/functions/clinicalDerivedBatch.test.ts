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
  currentVersion,
  dayPath,
  episodeDoc,
  episodePath,
  makeContext,
  makeDay,
  marker,
  vitals,
} from './clinicalDerivedServer.test-support';

type Mode = 'shadow' | 'enforced';
type Day = Record<string, unknown> & {
  beds: Record<string, Record<string, unknown> & { clinicalCrib?: Record<string, unknown> }>;
  meta: Record<string, unknown> & { revision: number };
  clinicalDerivedLayout?: unknown;
};

const NEW_VITALS = [vitals('2026-11-02', 72), vitals('2026-11-01', 70)];
const runEvent = (mode: Mode) => ({
  id: RUN_ID,
  status: 'applied',
  sourceDate: DAY,
  policy: { mode: 'preview', revision: 4, clinicalBatchMode: mode },
});

/** Marked day whose mother (R1) and passport patient (R2) were already split by earlier writes. */
const splitDay = (mode: Mode = 'enforced') => {
  const day = makeDay({ clinicalDerivedLayout: marker(), rayenSyncHistory: [runEvent(mode)] });
  const beds = day.beds as Day['beds'];
  delete beds.R1.vitalSignsHistory;
  delete beds.R1.clinicalSyncCheckpoint;
  delete beds.R2.vitalSignsHistory;
  delete beds.R2.clinicalSyncCheckpoint;
  return day;
};

const setup = (day: Record<string, unknown>, mode: Mode = 'enforced') => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, {
    schemaVersion: 2,
    mode: 'preview',
    revision: 4,
    clinicalBatchMode: mode,
  });
  fake.seed(dayPath(day.date as string), day);
  return { fake, api: batchApi(fake) };
};

const seedSplitDocs = (fake: ReturnType<typeof createFakeFirestore>) => {
  fake.seed(
    episodePath('ep_madre_1'),
    episodeDoc('ep_madre_1', {
      bedId: 'R1',
      vitalSignsHistory: [vitals('2026-11-01', 81)],
      clinicalSyncCheckpoint: checkpoint('m-doc'),
    })
  );
  fake.seed(
    episodePath('ep_pasaporte_2'),
    episodeDoc('ep_pasaporte_2', {
      vitalSignsHistory: [vitals('2026-11-01', 66)],
      clinicalSyncCheckpoint: checkpoint('p-doc'),
    })
  );
};

const payload = (overrides: Record<string, unknown> = {}) => ({
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
      fields: { vitalSignsHistory: NEW_VITALS, vitalSigns: NEW_VITALS[0] },
    },
  ],
  checkpoints: [
    { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-2') },
  ],
  clientRuntimeContractVersion: 3,
  ...overrides,
});

const writes = (fake: ReturnType<typeof createFakeFirestore>) =>
  fake.log.filter(entry => entry.op !== 'get');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('clinical batch on a split day (phase 1a P5)', () => {
  it('applies on the combined view and writes the day from the remote plus the target documents', async () => {
    const { fake, api } = setup(splitDay());
    seedSplitDocs(fake);
    const remote = structuredClone(fake.read(dayPath())) as Day;

    const response = await api.applyRayenClinicalEnrichmentBatch.run(payload(), makeContext());

    expect(response).toMatchObject({
      authorityStatus: 'ok',
      resultParity: 'matched',
      revision: 8,
      patientWrites: 1,
      historySnapshots: 1,
    });
    const day = fake.read(dayPath()) as Day;
    expect(day.clinicalDerivedLayout).toEqual(marker());
    expect(day.meta.revision).toBe(8);
    expect(day.beds.R2.vitalSigns).toEqual(NEW_VITALS[0]);
    // Neither the target nor the untouched split mother get document values back in the day.
    for (const bedId of ['R1', 'R2']) {
      expect(day.beds[bedId]).not.toHaveProperty('vitalSignsHistory');
      expect(day.beds[bedId]).not.toHaveProperty('clinicalSyncCheckpoint');
    }
    expect(day.beds.R1.clinicalCrib?.vitalSignsHistory).toEqual([vitals('2026-11-01', 140)]);
    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      layoutGeneration: 'gen-current',
      dayRevision: 8,
      lastMutationId: 'mutation-batch-1',
      vitalSignsHistory: NEW_VITALS,
      clinicalSyncCheckpoint: checkpoint('p-2'),
    });
    expect(fake.read(episodePath('ep_madre_1'))).toMatchObject({ lastMutationId: 'seed' });

    const [copyPath] = fake.paths(`${dayPath()}/history/rayen-clinical-`);
    expect(fake.read(copyPath)).toMatchObject({
      beds: remote.beds,
      snapshotReason: 'rayen_clinical_enrichment',
      clinicalDerivedPrevious: {
        ep_pasaporte_2: {
          document: {
            layoutGeneration: 'gen-current',
            date: DAY,
            vitalSignsHistory: [vitals('2026-11-01', 66)],
            clinicalSyncCheckpoint: checkpoint('p-doc'),
          },
        },
      },
    });
    const [telemetry] = fake.telemetry();
    expect(telemetry.context).toMatchObject({
      parityContractVersion: 3,
      clinicalDerivedLayout: 'marked',
      clinicalDerivedSplitEpisodes: 1,
      clinicalDerivedEmbeddedEpisodes: 0,
      clinicalDerivedOverlaidEpisodes: 1,
    });
    expect(JSON.stringify(telemetry)).not.toMatch(/ep_|AB123456|heartRate|gen-current/);
    // D7: the client version stays outside digests and receipts.
    expect(JSON.stringify(day.meta)).not.toContain('clientRuntimeContractVersion');
  });

  it('treats a batch that the documents already hold as a no-op', async () => {
    const { fake, api } = setup(splitDay());
    seedSplitDocs(fake);
    const request = payload({
      patches: [
        {
          bedId: 'R2',
          clinicalEpisodeId: 'ep_pasaporte_2',
          fields: { vitalSignsHistory: [vitals('2026-11-01', 66)] },
        },
      ],
      checkpoints: [
        { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-doc') },
      ],
    });

    const response = await api.applyRayenClinicalEnrichmentBatch.run(request, makeContext());

    expect(response).toMatchObject({ authorityStatus: 'idempotent', patientWrites: 0 });
    expect(writes(fake)).toEqual([]);
  });

  it.each([
    ['only the devices differ', { devices: ['CVC'] }, 0, 1],
    ['the history differs', { vitalSignsHistory: NEW_VITALS }, 1, 0],
  ])(
    'shadow parity v3 compares with the combined remote (%s) and writes nothing',
    async (_label, fields, vitalMismatches, deviceMismatches) => {
      const { fake, api } = setup(splitDay('shadow'), 'shadow');
      seedSplitDocs(fake);
      const request = payload({
        mode: 'shadow',
        patches: [
          {
            bedId: 'R2',
            clinicalEpisodeId: 'ep_pasaporte_2',
            // The document already holds this history; the remote day no longer embeds it.
            fields: { vitalSignsHistory: [vitals('2026-11-01', 66)], ...fields },
          },
        ],
        checkpoints: [],
      });

      const response = await api.applyRayenClinicalEnrichmentBatch.run(request, makeContext());

      expect(response.resultParity).toBe('mismatch');
      expect(writes(fake)).toEqual([]);
      expect(fake.telemetry()[0].context).toMatchObject({
        parityContractVersion: 3,
        mismatchVitalFieldCount: vitalMismatches,
        mismatchDeviceFieldCount: deviceMismatches,
      });
    }
  );

  it('rejects field contract v1 with moved fields on a marked day, but not without them', async () => {
    const { fake, api } = setup(splitDay());
    seedSplitDocs(fake);

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(payload({ fieldContractVersion: 1 }), makeContext())
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_field_contract_unsupported:/),
    });
    expect(writes(fake)).toEqual([]);

    const logStart = fake.log.length;
    const vitalsOnly = payload({
      fieldContractVersion: 1,
      patches: [
        { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', fields: { vitalSigns: NEW_VITALS[0] } },
      ],
      checkpoints: [],
      clientRuntimeContractVersion: undefined,
    });
    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(vitalsOnly, makeContext())
    ).resolves.toMatchObject({ authorityStatus: 'ok' });
    expect(
      fake.log.slice(logStart).filter(entry => entry.path.includes('/clinicalDerived/'))
    ).toEqual([]);
    expect((fake.read(dayPath()) as Day).clinicalDerivedLayout).toEqual(marker());
  });

  it('rejects an older client, and answers its retry of a committed batch idempotently', async () => {
    const { fake, api } = setup(splitDay());
    seedSplitDocs(fake);

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(
        payload({ clientRuntimeContractVersion: 2 }),
        makeContext()
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_client_outdated:/),
    });
    expect(writes(fake)).toEqual([]);

    await api.applyRayenClinicalEnrichmentBatch.run(payload(), makeContext());
    const committed = structuredClone(fake.read(dayPath()));
    const committedWrites = writes(fake).length;
    const retry = await api.applyRayenClinicalEnrichmentBatch.run(
      payload({ clientRuntimeContractVersion: undefined }),
      makeContext()
    );

    expect(retry).toMatchObject({ authorityStatus: 'idempotent', revision: 8 });
    expect(writes(fake)).toHaveLength(committedWrites);
    expect(fake.read(dayPath())).toEqual(committed);
  });

  it('marks an unmarked day; a checkpoint-only batch splits without a run copy', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const { fake, api } = setup(makeDay({ rayenSyncHistory: [runEvent('enforced')] }));

    await api.applyRayenClinicalEnrichmentBatch.run(payload({ patches: [] }), makeContext());

    const day = fake.read(dayPath()) as Day & { clinicalDerivedLayout: { generation: string } };
    expect(day.clinicalDerivedLayout).toEqual({ version: 1, generation: expect.any(String) });
    expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(day.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      layoutGeneration: day.clinicalDerivedLayout.generation,
      dayRevision: 8,
      clinicalSyncCheckpoint: checkpoint('p-2'),
      vitalSignsHistory: [vitals('2026-11-01', 70)],
    });
    expect(fake.paths(`${dayPath()}/history/`)).toEqual([]);
  });

  it('adds the episodes of a later chunk of the same run to the existing run copy', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const { fake, api } = setup(makeDay({ rayenSyncHistory: [runEvent('enforced')] }));
    await api.applyRayenClinicalEnrichmentBatch.run(payload(), makeContext());
    const [firstCopyPath] = fake.paths(`${dayPath()}/history/`);
    const firstCopy = structuredClone(fake.read(firstCopyPath)) as Day & {
      clinicalDerivedPrevious: Record<string, unknown>;
    };
    // The split episode's embedded values move into the previous entry instead of being duplicated.
    expect(firstCopy.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(firstCopy.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(firstCopy.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
    expect(firstCopy.clinicalDerivedPrevious).toEqual({
      ep_pasaporte_2: {
        embedded: {
          clinicalSyncCheckpoint: checkpoint('p-1'),
          vitalSignsHistory: [vitals('2026-11-01', 70)],
        },
      },
    });
    const nextChunk = payload({
      mutationId: 'mutation-batch-2',
      expectedLastUpdated: currentVersion(fake),
      baseRevision: 8,
      patches: [
        {
          bedId: 'R1',
          clinicalEpisodeId: 'ep_madre_1',
          fields: { vitalSignsHistory: [vitals('2026-11-02', 88)] },
        },
      ],
      checkpoints: [],
    });

    const response = await api.applyRayenClinicalEnrichmentBatch.run(nextChunk, makeContext());

    expect(response.historySnapshots).toBe(0);
    const [copyPath, ...others] = fake.paths(`${dayPath()}/history/`);
    expect(others).toEqual([]);
    const previous = (fake.read(copyPath) as Record<string, Record<string, unknown>>)
      .clinicalDerivedPrevious;
    expect(Object.keys(previous).sort()).toEqual(['ep_madre_1', 'ep_pasaporte_2']);
    expect(previous.ep_madre_1).toEqual({
      embedded: {
        clinicalSyncCheckpoint: checkpoint('m-1'),
        vitalSignsHistory: [vitals('2026-11-01', 80)],
      },
    });
  });

  it('writes a historical CUDYR target from the remote: keeps a marker, never adds one', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    for (const priorMarker of [marker('gen-prior'), undefined]) {
      const fake = createFakeFirestore();
      fake.seed(POLICY_PATH, {
        schemaVersion: 2,
        mode: 'preview',
        revision: 4,
        clinicalBatchMode: 'enforced',
      });
      fake.seed(dayPath(), makeDay({ rayenSyncHistory: [runEvent('enforced')] }));
      const prior = makeDay({
        date: PRIOR_DAY,
        lastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
        rayenSyncHistory: [],
        ...(priorMarker ? { clinicalDerivedLayout: priorMarker } : {}),
      });
      fake.seed(dayPath(PRIOR_DAY), prior);
      const cudyr = { category: 'C2', recordedDate: PRIOR_DAY, source: 'Rayen sintético' };

      await batchApi(fake, 'admin').applyRayenClinicalEnrichmentBatch.run(
        payload({
          date: PRIOR_DAY,
          expectedLastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
          patches: [
            {
              bedId: 'R2',
              clinicalEpisodeId: 'ep_pasaporte_2',
              fields: { evaluationScores: { cudyr } },
            },
          ],
          checkpoints: [],
          clientRuntimeContractVersion: undefined,
        }),
        makeContext()
      );

      const stored = fake.read(dayPath(PRIOR_DAY)) as Day;
      expect(stored.clinicalDerivedLayout).toEqual(priorMarker);
      expect(stored.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-01', 70)]);
      expect((stored.beds.R2.evaluationScores as Record<string, unknown>).cudyr).toEqual(cudyr);
      expect(fake.touched('/clinicalDerived/')).toEqual([]);
    }
  });

  it('checks the size of every episode document it writes', async () => {
    // Day and request fit; only the episode document (embedded history + new checkpoint) does not.
    const day = splitDay();
    const r2 = (day.beds as Day['beds']).R2;
    r2.vitalSignsHistory = [{ ...vitals('2026-11-01', 60), note: 'h'.repeat(520_000) }];
    const { fake, api } = setup(day);
    const largeCheckpoint = { version: 1, sources: { vitals: { fill: 'x'.repeat(400_000) } } };
    expect(Buffer.byteLength(JSON.stringify(day))).toBeLessThan(600_000);

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(
        payload({
          patches: [],
          checkpoints: [
            { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: largeCheckpoint },
          ],
        }),
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(writes(fake)).toEqual([]);
  });
});
