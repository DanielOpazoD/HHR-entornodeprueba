import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  POLICY_PATH,
  PRIOR_DAY,
  SPLIT_ENV,
  checkpoint,
  createFakeFirestore,
  dayPath,
  episodeDoc,
  episodePath,
  makeContext,
  makeDay,
  marker,
  vitals,
  writeApi,
} from './clinicalDerivedServer.test-support';

type Holder = Record<string, unknown>;
type Day = Record<string, unknown> & {
  beds: Record<string, Holder & { clinicalCrib?: Holder | null }>;
  clinicalDerivedLayout?: { version: number; generation: string };
};

const fencePolicy = { schemaVersion: 2, mode: 'preview', revision: 4, clinicalBatchMode: 'shadow' };
const forgedMarker = { version: 1, generation: 'client-forged' };

const save = (
  fake: ReturnType<typeof createFakeFirestore>,
  record: Record<string, unknown>,
  client: Record<string, unknown> = { clientRuntimeContractVersion: 3 }
) =>
  writeApi(fake, 'admin').saveDailyRecordWithClinicalAuthority.run(
    { date: record.date, mode: 'shadow', record, ...client },
    makeContext()
  );

const writesTo = (fake: ReturnType<typeof createFakeFirestore>, fragment: string) =>
  fake.log.filter(entry => entry.op !== 'get' && entry.path.includes(fragment));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('full save on split days (phase 1a P5)', () => {
  it('creates a day on or after the start with a fresh marker, ignoring the client one', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = createFakeFirestore();

    const response = await save(fake, makeDay({ clinicalDerivedLayout: forgedMarker }));

    const day = fake.read(dayPath()) as Day;
    expect(day.clinicalDerivedLayout).toEqual({ version: 1, generation: expect.any(String) });
    expect(day.clinicalDerivedLayout?.generation).not.toBe(forgedMarker.generation);
    // Creation writes no episode document: what it carries stays embedded.
    expect(day.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-01', 70)]);
    expect(writesTo(fake, '/clinicalDerived/')).toEqual([]);
    expect(response.recordState.record.clinicalDerivedLayout).toEqual(day.clinicalDerivedLayout);
    expect(fake.telemetry()[0].context).toMatchObject({ clinicalDerivedLayout: 'marking' });
  });

  it('takes the moved fields of a day its creation marks only from a current client (D7)', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = createFakeFirestore();

    for (const client of [{}, { clientRuntimeContractVersion: 2 }]) {
      await expect(save(fake, makeDay(), client)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/^clinical_derived_client_outdated:/),
      });
    }
    expect(fake.read(dayPath())).toBeUndefined();

    // A creation that carries no moved field (the empty census of a new day) needs no version.
    const empty = makeDay();
    Object.values(empty.beds as Day['beds']).forEach(bed => {
      delete bed.vitalSignsHistory;
      delete bed.clinicalSyncCheckpoint;
      delete bed.clinicalCrib?.vitalSignsHistory;
    });
    await save(fake, empty, {});
    expect(fake.read(dayPath())).toHaveProperty('clinicalDerivedLayout');

    // With the Rayen fence the server drops the client's clinical fields and seeds its own carryover:
    // nothing the older client sent is kept, so it may create the day.
    const fenced = createFakeFirestore();
    fenced.seed(POLICY_PATH, fencePolicy);
    fenced.seed(dayPath(PRIOR_DAY), makeDay({ date: PRIOR_DAY }));
    const request = makeDay();
    const beds = request.beds as Day['beds'];
    beds.R1.vitalSignsHistory = [vitals('2026-11-02', 1)];
    beds.R2.clinicalCarryover = { sourceDate: PRIOR_DAY };
    await save(fenced, request, {});
    const day = fenced.read(dayPath()) as Day;
    expect(day).toHaveProperty('clinicalDerivedLayout');
    expect(day.beds.R1).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-01', 70)]);
  });

  it('drops a client marker on a day created before the start', async () => {
    vi.stubEnv(SPLIT_ENV, '2026-11-03');
    const fake = createFakeFirestore();

    await save(fake, makeDay({ clinicalDerivedLayout: forgedMarker }));

    expect(fake.read(dayPath())).not.toHaveProperty('clinicalDerivedLayout');
    expect(fake.telemetry()[0].context).not.toHaveProperty('clinicalDerivedLayout');
  });

  it('seeds the carryover of a new day from a split prior day with its documents overlaid', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const fake = createFakeFirestore();
    fake.seed(POLICY_PATH, fencePolicy);
    const prior = makeDay({
      date: PRIOR_DAY,
      lastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
      clinicalDerivedLayout: marker('gen-prior'),
    });
    delete (prior.beds as Day['beds']).R2.vitalSignsHistory;
    fake.seed(dayPath(PRIOR_DAY), prior);
    const docReadings = [vitals('2026-11-01', 66), vitals('2026-10-31', 64)];
    fake.seed(
      episodePath('ep_pasaporte_2', PRIOR_DAY),
      episodeDoc('ep_pasaporte_2', {
        date: PRIOR_DAY,
        layoutGeneration: 'gen-prior',
        vitalSignsHistory: docReadings,
        clinicalSyncCheckpoint: checkpoint('p-prior'),
      })
    );
    const request = makeDay();
    const r2 = (request.beds as Day['beds']).R2;
    delete r2.vitalSignsHistory;
    r2.clinicalCarryover = { sourceDate: PRIOR_DAY };

    await save(fake, request);

    const day = fake.read(dayPath()) as Day;
    expect(day.beds.R2.vitalSignsHistory).toEqual(docReadings);
    expect(day.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(day.beds.R2.clinicalCarryover).toMatchObject({
      sourceDate: PRIOR_DAY,
      clinicalEpisodeId: 'ep_pasaporte_2',
      vitalsPending: true,
    });
    expect(day.beds.R2).toMatchObject({ rut: 'AB123456', documentType: 'Pasaporte' });
    expect(day.clinicalDerivedLayout?.generation).not.toBe('gen-prior');
    expect(writesTo(fake, '/clinicalDerived/')).toEqual([]);
  });

  it('fails closed when the prior day carries a marker this server does not understand', async () => {
    const fake = createFakeFirestore();
    fake.seed(POLICY_PATH, fencePolicy);
    fake.seed(
      dayPath(PRIOR_DAY),
      makeDay({ date: PRIOR_DAY, clinicalDerivedLayout: { version: 9, generation: 'g' } })
    );
    const request = makeDay();
    (request.beds as Day['beds']).R2.clinicalCarryover = { sourceDate: PRIOR_DAY };

    await expect(save(fake, request)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_layout_unsupported:/),
    });
    expect(fake.read(dayPath())).toBeUndefined();
  });

  it.each([
    ['without', null],
    ['with', fencePolicy],
  ])(
    'keeps a mid-life marked day intact %s the fence: remote marker, moved fields by episode',
    async (_label, policy) => {
      vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
      const fake = createFakeFirestore();
      if (policy) fake.seed(POLICY_PATH, policy);
      // R2 is split (document only); the mother and her newborn still embed theirs.
      const remote = makeDay({ clinicalDerivedLayout: marker() });
      const remoteBeds = remote.beds as Day['beds'];
      delete remoteBeds.R2.vitalSignsHistory;
      delete remoteBeds.R2.clinicalSyncCheckpoint;
      fake.seed(dayPath(), remote);
      fake.seed(
        episodePath('ep_pasaporte_2'),
        episodeDoc('ep_pasaporte_2', { vitalSignsHistory: [vitals('2026-11-01', 66)] })
      );
      const documentBefore = structuredClone(fake.read(episodePath('ep_pasaporte_2')));

      // An older client: no marker, stale moved fields, and the newborn moved to its own bed R3.
      const incoming = makeDay();
      const beds = incoming.beds as Day['beds'];
      const newborn = { ...(beds.R1.clinicalCrib as Holder) };
      delete newborn.vitalSignsHistory;
      beds.R1 = { ...beds.R1, clinicalCrib: null, pathology: 'Cambio estructural' };
      beds.R1.vitalSignsHistory = [vitals('2026-11-01', 1)];
      beds.R2.vitalSignsHistory = [vitals('2026-10-01', 2)];
      beds.R3 = { ...newborn, bedId: 'R3', isBlocked: false };

      const response = await save(fake, incoming);

      const day = fake.read(dayPath()) as Day;
      expect(day.clinicalDerivedLayout).toEqual(marker());
      expect(day.beds.R1.pathology).toBe('Cambio estructural');
      expect(day.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
      expect(day.beds.R1.clinicalSyncCheckpoint).toEqual(checkpoint('m-1'));
      expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
      expect(day.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
      // The newborn keeps its embedded history across the crib -> bed move (episode id only).
      expect(day.beds.R3.vitalSignsHistory).toEqual([vitals('2026-11-01', 140)]);
      expect(day.beds.R3).toMatchObject({ rut: 'XK1234567', documentType: 'Pasaporte' });
      expect(fake.read(episodePath('ep_pasaporte_2'))).toEqual(documentBefore);
      expect(writesTo(fake, '/clinicalDerived/')).toEqual([]);
      // Holders with a valid id (mother, passport patient, newborn) all settle from the remote.
      expect(fake.telemetry()[0].context).toMatchObject({
        clinicalDerivedLayout: 'marked',
        clinicalDerivedPreservedEpisodes: 3,
      });
      // D8: the response is the day as persisted.
      expect(response.recordState.record.clinicalDerivedLayout).toEqual(marker());
      expect(response.recordState.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
      expect(response.recordState.record.beds.R3.vitalSignsHistory).toEqual(
        day.beds.R3.vitalSignsHistory
      );
    }
  );

  it('keeps a marker this server does not understand, byte for byte, with remote moved fields', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const fake = createFakeFirestore();
    const unknownMarker = { version: 2, generation: 'g-next', extra: { shards: 4 } };
    fake.seed(dayPath(), makeDay({ clinicalDerivedLayout: unknownMarker }));
    const incoming = makeDay();
    (incoming.beds as Day['beds']).R2.vitalSignsHistory = [vitals('2026-11-02', 75)];

    await save(fake, incoming);

    const day = fake.read(dayPath()) as Day;
    expect(day.clinicalDerivedLayout).toEqual(unknownMarker);
    expect(day.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-01', 70)]);
    expect(fake.touched('/clinicalDerived/')).toEqual([]);
  });

  it('never marks an existing unmarked day, even with the switch on and a client marker', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const fake = createFakeFirestore();
    fake.seed(dayPath(), makeDay());
    const incoming = makeDay({ clinicalDerivedLayout: forgedMarker });
    (incoming.beds as Day['beds']).R2.vitalSignsHistory = [vitals('2026-11-02', 75)];

    await save(fake, incoming);

    const day = fake.read(dayPath()) as Day;
    expect(day).not.toHaveProperty('clinicalDerivedLayout');
    // Without the fence an unmarked day keeps today's behaviour: the client's embedded value.
    expect(day.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-02', 75)]);
    expect(fake.touched('/clinicalDerived/')).toEqual([]);
  });
});
