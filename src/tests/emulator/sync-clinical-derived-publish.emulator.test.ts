/**
 * Queue publish (merge: true) to a split day under the real rules (D3 and D9 of
 * DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): the stored marker and revision survive, the
 * stored embedded copy of an episode not split yet follows that episode, nothing another episode
 * left in a bed stays under its new occupant, and a recreated day never carries a marker (the
 * create rule denies it). Synthetic data only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  isServerClinicalWriteFenceActive: async () => false,
}));

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
const date = '2026-11-02';
const path = `hospitals/hanga_roa/dailyRecords/${date}`;
const marker = { version: 1, generation: 'gen_synthetic_a' };
let environment: RulesTestEnvironment;

const moved = (label: string) => ({
  clinicalSyncCheckpoint: { version: 3, fingerprintVersion: 1, sources: { vitals: label } },
  vitalSignsHistory: [{ recordedDate: date, recordedAt: `${date}T08:00:00`, author: label }],
});
const patient = (bedId: string, clinicalEpisodeId: string, extra: object = {}) =>
  DataFactory.createMockPatient(bedId, {
    patientName: `Paciente sintético ${clinicalEpisodeId}`,
    rut: '11.111.111-1',
    clinicalEpisodeId,
    ...extra,
  } as Partial<PatientData>);
const day = (lastUpdated: string, beds: Record<string, PatientData>, extra: object = {}) =>
  ({ ...DataFactory.createMockDailyRecord(date, { lastUpdated }), beds, ...extra }) as DailyRecord;
const publish = (payload: DailyRecord) => {
  const db = environment.authenticatedContext('synthetic-admin', { role: 'admin' }).firestore();
  return createFirestoreSyncTransport({
    getDb: () => db as unknown as Firestore,
    ready: Promise.resolve(),
  }).run({
    opId: 'synthetic-split-op',
    type: 'UPDATE_DAILY_RECORD',
    payload,
    timestamp: 1,
    retryCount: 0,
    status: 'PENDING',
  });
};
const stored = async () => {
  let data: Record<string, unknown> | undefined;
  await environment.withSecurityRulesDisabled(async context => {
    data = (await context.firestore().doc(path).get()).data();
  });
  return data as Record<string, unknown> & { beds: Record<string, Record<string, unknown>> };
};

beforeAll(async () => {
  if (!enabled) return;
  const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
  environment = await initializeTestEnvironment({
    projectId: 'demo-hhr-sync-clinical-derived',
    firestore: { host, port, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
  });
});
beforeEach(async () => {
  if (enabled) await environment.clearFirestore();
});
afterAll(async () => {
  if (environment) await environment.cleanup();
});

it.skipIf(!enabled)(
  'keeps the split-day state and leaves no other episode’s copy under a new occupant',
  async () => {
    // Seeded as stored data, so without the undefined keys the mock factory leaves.
    const seed = day(
      `${date}T09:00:00.000Z`,
      // ep_a is split (its document holds the data); ep_c is not split yet.
      { R1: patient('R1', 'ep_a'), R2: patient('R2', 'ep_c', moved('stored-c')) },
      { clinicalDerivedLayout: marker, meta: { revision: 8 } }
    );
    await environment.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(path)
        .set(JSON.parse(JSON.stringify(seed)));
    });

    // A queued copy taken before the split, after ep_c moved to R4 and ep_new took R2.
    await publish(
      day(
        `${date}T10:00:00.000Z`,
        {
          R1: patient('R1', 'ep_a', moved('local-a')),
          R2: patient('R2', 'ep_new', moved('local-new')),
          R4: patient('R4', 'ep_c', moved('local-c')),
        },
        { meta: { revision: 3 } }
      )
    );

    const data = await stored();
    expect(data.clinicalDerivedLayout).toEqual(marker);
    expect(data.meta).toEqual({ revision: 8 });
    expect(data.beds.R1).not.toHaveProperty('vitalSignsHistory');
    expect(data.beds.R2).toMatchObject({ clinicalEpisodeId: 'ep_new' });
    expect(data.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(data.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(data.beds.R4).toMatchObject(moved('stored-c'));
  }
);

it.skipIf(!enabled)('recreates a day from a marked queued copy without the marker', async () => {
  await publish(
    day(
      `${date}T10:00:00.000Z`,
      { R1: patient('R1', 'ep_a', moved('local-a')) },
      { clinicalDerivedLayout: marker }
    )
  );

  const data = await stored();
  expect(data).not.toHaveProperty('clinicalDerivedLayout');
  expect(data.beds.R1).toMatchObject(moved('local-a'));
});
