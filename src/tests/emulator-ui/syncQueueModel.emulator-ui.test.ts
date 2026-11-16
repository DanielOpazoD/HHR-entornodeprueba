/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import { getSyncQueueTelemetry, processSyncQueue } from '@/services/storage/sync';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  getSessionGeneration,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { resolveRecordBaseRevision } from '@/services/storage/sync/syncTaskContractPolicy';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/**
 * Model-based test of this computer's save queue (W12-MODEL1). fast-check draws sequences of what
 * people do (edit with or without network, the network coming back, the queue resending, another
 * computer writing, a person signing in, out or over another, a page reload) and runs them on the
 * shipped code: the real repository, outbox, queue, transport, session cleanup and the shipped
 * authority handler, against the Firestore emulator. After every step the model checks the rules
 * of docs/DOMAIN_RULES.md that hold for every sequence (SAVE-01, SAVE-02, SAVE-03, Sesión), and
 * at the end, with the network back and the queue run, that nothing is left waiting and a conflict
 * stays only where another computer changed one of its fields.
 * `FC_NUM_RUNS` / `FC_SEED` repeat or widen a run, as in src/tests/properties.
 */

// Bind SDK/auth per async writer; a mutable global DB would mix the two computers mid-write.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>() };
});
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return scope.getStore()?.db;
  },
  auth: {
    get currentUser() {
      const actor = scope.getStore();
      return actor
        ? {
            uid: actor.uid,
            email: `${actor.uid}@example.invalid`,
            displayName: 'Persona sintética',
            isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { role: actor.role } }),
          }
        : null;
    },
  },
  storage: {},
  functions: {},
  firebaseReady: Promise.resolve(),
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(),
  mountConfigWarning: vi.fn(),
}));

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-queue-state-model';
const FIELDS = ['handoffNovedadesDayShift', 'handoffNovedadesNightShift'] as const;
type Field = (typeof FIELDS)[number];
const PEOPLE = ['P1', 'P2'] as const;
type Person = (typeof PEOPLE)[number];
const ownerOf = (person: Person) => `user:synthetic-${person}`;
const patchOf = (field: Field, value: string): DailyRecordPatch =>
  field === 'handoffNovedadesDayShift'
    ? { handoffNovedadesDayShift: value }
    : { handoffNovedadesNightShift: value };
const baseRecord = () => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    handoffNovedadesDayShift: 'DIA BASE',
    handoffNovedadesNightShift: 'NOCHE BASE',
    activeExtraBeds: [],
  }),
  meta: { revision: 1 },
});

// ── The reference model (what a person may expect, whatever the code does) ──────────────────────
/** An edit this computer accepted: its unique text, who wrote it and the text it replaced. */
interface Edit {
  value: string;
  field: Field;
  owner: string;
  generation: string | null;
  base: unknown;
}
interface Model {
  online: boolean;
  person: Person | null;
  edits: Edit[];
  server: Record<Field, unknown>;
  everOnServer: Set<unknown>;
  count: number;
  log: string[];
}
const newModel = (): Model => ({
  online: true,
  person: 'P1',
  edits: [],
  server: { handoffNovedadesDayShift: 'DIA BASE', handoffNovedadesNightShift: 'NOCHE BASE' },
  everOnServer: new Set(['DIA BASE', 'NOCHE BASE']),
  count: 0,
  log: [],
});
const editOf = (m: Model, value: unknown) => m.edits.find(edit => edit.value === value);
/** The texts an edit was written over: its base, the base of that one if it was ours, and so on. */
const replacedBy = (m: Model, edit: Edit): unknown[] => {
  const chain: unknown[] = [];
  for (let base: unknown = edit.base; ; ) {
    chain.push(base);
    const previous = editOf(m, base);
    if (!previous || previous.field !== edit.field) return chain;
    base = previous.base;
  }
};
/** Confirmed by the server, or replaced by a later edit of the same person on the same field. */
const settled = (m: Model, edit: Edit) =>
  m.everOnServer.has(edit.value) ||
  m.edits.some(
    later =>
      m.edits.indexOf(later) > m.edits.indexOf(edit) &&
      later.owner === edit.owner &&
      later.field === edit.field
  );
const heldBy = (tasks: SyncTask[], edit: Edit) =>
  tasks.filter(
    task =>
      task.ownerKey === edit.owner &&
      (task.payload as Partial<DailyRecord> | undefined)?.[edit.field] === edit.value
  );

/** Every rule, after every step. Each failure names the rule and the sequence so far. */
const checkRules = async (m: Model, step: string) => {
  m.log.push(step);
  const fail = (rule: string, detail: string): never => {
    throw new Error(`${rule}: ${detail}\nPasos: ${m.log.join(' → ')}`);
  };
  const server = await readServer();
  const tasks = await hospitalDB.syncQueue.toArray();
  const owner = m.person ? ownerOf(m.person) : null;
  for (const field of FIELDS) {
    const before = m.server[field];
    const now = server[field];
    // The other computer writes over the server's current text by construction.
    if (now === before || (typeof now === 'string' && now.startsWith('A'))) continue;
    const edit = editOf(m, now);
    // SAVE-02: a text reaches the server only over the text its writer saw (no lost update).
    if (!edit || !replacedBy(m, edit).includes(before))
      return fail(
        'SAVE-02',
        `${field}: «${String(before)}» reemplazado por «${String(now)}» sin verlo`
      );
    // Sesión: nothing is published for a session that is no longer the current one.
    if (edit.owner !== owner || edit.generation !== getSessionGeneration())
      fail(
        'Sesión',
        `«${String(now)}», escrito en otra sesión de ${edit.owner}, se publicó en la de ${owner}`
      );
  }
  for (const field of FIELDS) {
    m.server[field] = server[field];
    m.everOnServer.add(server[field]);
  }
  // SAVE-03 and «nunca desaparece»: confirmed, replaced by its author, or still held for its author.
  const unsettled = m.edits.filter(edit => !settled(m, edit));
  for (const edit of unsettled)
    if (heldBy(tasks, edit).length === 0)
      fail('SAVE-03', `«${edit.value}» de ${edit.owner} no está en el servidor ni en la cola`);
  if (!owner) return;
  // SAVE-01: the status box never says «al día» while an edit of this person is unconfirmed.
  const telemetry = await getSyncQueueTelemetry();
  const mine = unsettled.filter(edit => edit.owner === owner);
  if (telemetry.readState === 'ok' && mine.length > 0)
    if (telemetry.pending + telemetry.failed + telemetry.conflict === 0)
      fail('SAVE-01', `la cola se muestra al día con «${mine[0].value}» sin confirmar`);
};

// ── The shipped code, two computers and the emulator ─────────────────────────────────────────────
let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
let deviceA: { db: unknown; uid: string; role: string };
let deviceB: { db: { disableNetwork(): Promise<void>; enableNetwork(): Promise<void> } };
let skew = 0;
const realNow = Date.now.bind(Date);
const onB = <T>(person: Person | null, action: () => T): T =>
  scope.run(
    { db: deviceB.db, uid: person ? `synthetic-${person}` : '', role: 'nurse_hospital' },
    action
  );
const readServer = async (): Promise<DailyRecord> => {
  const data = (await admin.doc(dayPath).get()).data();
  if (!data) throw new Error('Synthetic census missing');
  const stamp = data.lastUpdated;
  return docToRecord(
    { ...data, lastUpdated: stamp instanceof Timestamp ? stamp.toDate().toISOString() : stamp },
    date
  );
};
const loadDay = (m: Model) =>
  m.online && m.person ? onB(m.person, () => syncWithFirestoreDetailed(date)) : undefined;
const admit = async (m: Model, person: Person) => {
  await onB(person, () => reconcileAuthorizedSessionOwner(ownerOf(person)));
  m.person = person;
  await loadDay(m);
};

type Command = fc.AsyncCommand<Model, object>;
const command = (
  name: string,
  check: (m: Model) => boolean,
  run: (m: Model) => Promise<string | void>
): Command => ({
  check,
  run: async m => checkRules(m, (await run(m)) ?? name),
  toString: () => name,
});

const editOnB = (field: Field) =>
  command(
    `editar ${field.slice(-8)}`,
    m => m.person !== null,
    async m => {
      const person = m.person as Person;
      const local = await hospitalDB.dailyRecords.get(date);
      if (!local) return 'editar (día no cargado)';
      const value = `B${++m.count}`;
      const authoringSession = captureAuthoringSession();
      const result = await onB(person, () =>
        updatePartialDetailed(date, patchOf(field, value), { authoringSession, baseRecord: local })
      );
      if (!result.savedLocally) return `editar ${value} (rechazada)`;
      const { generation } = authoringSession;
      m.edits.push({
        value,
        field,
        base: local[field],
        owner: ownerOf(person),
        generation,
      });
      // SAVE-01: «guardado» only when the server holds it.
      if (result.updatedRemotely && (await readServer())[field] !== value)
        throw new Error(`SAVE-01: «${value}» se informó guardado sin estar en el servidor`);
      return `editar ${value}${m.online ? '' : ' sin red'}`;
    }
  );
const writeOnA = (field: Field) =>
  command(
    `otro equipo escribe ${field.slice(-8)}`,
    () => true,
    async m => {
      const current = await readServer();
      const value = `A${++m.count}`;
      await scope.run(deviceA, () =>
        writes.updateRecordPartial(date, patchOf(field, value), current.lastUpdated, {
          historyPolicy: 'skip',
          baseRecord: current,
          syncContract: {
            mutationId: `synthetic-A-${value}`,
            baseRevision: resolveRecordBaseRevision(current),
            changedPaths: [field],
          },
        })
      );
      return `otro equipo escribe ${value} en ${field.slice(-8)}`;
    }
  );
const network = (online: boolean) =>
  command(
    online ? 'vuelve la red' : 'se corta la red',
    m => m.online !== online,
    async m => {
      m.online = online;
      // As the app does when the browser reports it (buildAuthRemoteSyncState).
      setFirestoreSyncState(
        online ? { mode: 'enabled', reason: 'ready' } : { mode: 'local_only', reason: 'offline' }
      );
      await (online ? deviceB.db.enableNetwork() : deviceB.db.disableNetwork());
    }
  );
const replay = command(
  'reenvío de la cola',
  m => m.online && m.person !== null,
  async m => {
    // Past any retry wait or pre-outbox hold; the clock only moves forward.
    skew += 10 * 60_000;
    await onB(m.person, () => processSyncQueue());
  }
);
const refresh = command(
  'llega el día del servidor',
  m => m.online && m.person !== null,
  async m => {
    await loadDay(m);
  }
);
const signIn = (person: Person) =>
  command(
    `entra ${person}`,
    m => m.person !== person,
    async m => {
      await admit(m, person);
    }
  );
const signOut = command(
  'cierra sesión',
  m => m.person !== null,
  async m => {
    await onB(m.person, () => clearSessionScopedClientState('manual'));
    m.person = null;
  }
);
const reload = command(
  'recarga la página',
  m => m.person !== null,
  async m => {
    hospitalDB.close();
    await hospitalDB.open();
    setSessionGeneration(null);
    await admit(m, m.person as Person);
  }
);
/** Weighted toward what fills a queue: editing and resending. */
const commands = [
  ...FIELDS.flatMap(field => Array(3).fill(fc.constant(editOnB(field)))),
  ...FIELDS.map(field => fc.constant(writeOnA(field))),
  fc.constant(network(false)),
  fc.constant(network(true)),
  fc.constant(replay),
  fc.constant(replay),
  fc.constant(refresh),
  ...PEOPLE.map(person => fc.constant(signIn(person))),
  fc.constant(signOut),
  fc.constant(reload),
];

/**
 * At the end the network is back and the queue has run: nothing of the current session is left
 * waiting, and a conflict is kept only where someone else changed one of its fields.
 */
const checkSettledAfterDrain = async (m: Model) => {
  if (!m.online) await network(true).run(m, {});
  if (!m.person) await signIn('P1').run(m, {});
  for (let round = 0; round < 3; round++) await replay.run(m, {});
  const server = await readServer();
  const owner = ownerOf(m.person as Person);
  for (const task of await hospitalDB.syncQueue.toArray()) {
    if (task.ownerKey !== owner || task.lastErrorCode === 'session_owner_logged_out') continue;
    const payload = task.payload as Partial<DailyRecord>;
    const changedElsewhere = m.edits.some(
      edit =>
        payload[edit.field] === edit.value &&
        server[edit.field] !== edit.value &&
        !replacedBy(m, edit).includes(server[edit.field])
    );
    if (task.status === 'CONFLICT' && changedElsewhere) continue;
    throw new Error(
      `Al terminar: tarea ${task.status} (${task.lastErrorCode ?? 'sin código'}) de ${owner} ` +
        `sin un cambio ajeno que la explique\nPasos: ${m.log.join(' → ')}`
    );
  }
};

/** A fresh census, an empty queue and P1 signed in on computer B. */
const resetWorld = async () => {
  await deviceB.db.enableNetwork();
  setFirestoreEnabled(true);
  await env.clearFirestore();
  await onB(null, () => clearSessionScopedClientState('manual')).catch(() => undefined);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  localStorage.clear();
  await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
    schemaVersion: 2,
    mode: 'preview',
    revision: 7,
    clinicalBatchMode: 'enforced',
  });
  await admin.doc(dayPath).set(baseRecord());
  const m = newModel();
  await admit(m, 'P1');
  return m;
};

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('the save queue against its reference model', () => {
  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(
      process.env.FIRESTORE_EMULATOR_HOST ?? ''
    );
    if (!endpoint) throw new Error('A loopback Firestore emulator is required');
    env = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
    app = initializeApp({ projectId }, 'queue-state-model');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
    const signedIn = (uid: string) =>
      env.authenticatedContext(uid, { email: `${uid}@example.invalid`, role: 'nurse_hospital' });
    deviceA = {
      uid: 'synthetic-A',
      role: 'nurse_hospital',
      db: signedIn('synthetic-A').firestore(),
    };
    deviceB = { db: signedIn('synthetic-B').firestore() as unknown as typeof deviceB.db };
    setFirestoreEnabled(true);
    // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', '');
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
    // The queue runs only when a step says so: the browser's own wake-ups are steps here.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    const context = () => ({
      auth: {
        uid: scope.getStore()?.uid,
        token: { email: `${scope.getStore()?.uid}@example.invalid` },
      },
    });
    // Only the callable transport is replaced: the shipped handler runs its real admin transaction.
    vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        try {
          return await api.patchDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        try {
          return await api.saveDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  // The counterexample this model found, shrunk by fast-check (W12-MODEL1). The first edit meets
  // the other computer's text and answers «El campo cambió en otro equipo»; the day it keeps
  // carries a local time newer than the server's version, and the next edit passed as this
  // computer's own write and replaced a text nobody here had seen, reported as saved (W12-CW5).
  it('keeps the other computer’s text when a second edit follows a «changed elsewhere» notice', async () => {
    const m = await resetWorld();
    const night = 'handoffNovedadesNightShift';
    await writeOnA(night).run(m, {});
    const edit = async (field: Field, value: string) => {
      const local = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      return onB('P1', () =>
        updatePartialDetailed(date, patchOf(field, value), {
          authoringSession: captureAuthoringSession(),
          baseRecord: local,
        })
      );
    };
    expect(await edit(night, 'B2')).toMatchObject({
      updatedRemotely: false,
      outcome: 'auto_merged',
    });
    const second = await edit(night, 'B3');
    expect((await readServer())[night]).toBe('A1');
    expect(second.updatedRemotely).toBe(false);
    expect(second.observabilityTags).toContain('field_changed_elsewhere');

    // A field nobody else changed is still saved at once, without a notice (#1603).
    const day = await edit('handoffNovedadesDayShift', 'B4');
    expect(day).toMatchObject({ updatedRemotely: true });
    expect(day.observabilityTags).not.toContain('field_changed_elsewhere');
    expect(await readServer()).toMatchObject({
      handoffNovedadesDayShift: 'B4',
      handoffNovedadesNightShift: 'A1',
    });
  }, 60_000);

  // What the per-field check must not mistake for another computer: this computer's own edit
  // of the same field, made without network and not resent yet.
  it('saves an edit over this computer’s own unsent edit of the same field without a notice', async () => {
    const m = await resetWorld();
    const night = 'handoffNovedadesNightShift';
    const edit = async (value: string) => {
      const local = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      return onB('P1', () =>
        updatePartialDetailed(date, patchOf(night, value), {
          authoringSession: captureAuthoringSession(),
          baseRecord: local,
        })
      );
    };
    await network(false).run(m, {});
    expect(await edit('B1')).toMatchObject({ savedLocally: true, updatedRemotely: false });
    await network(true).run(m, {});

    const online = await edit('B2');
    expect(online).toMatchObject({ updatedRemotely: true });
    expect(online.observabilityTags).not.toContain('field_changed_elsewhere');
    expect((await readServer())[night]).toBe('B2');
  }, 60_000);

  it('keeps every rule after every step of random sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 16, size: '+1' }), async sequence => {
        const m = await resetWorld();
        await fc.asyncModelRun(() => ({ model: m, real: {} }), sequence);
        await checkSettledAfterDrain(m);
      }),
      {
        // About 20 s on a laptop; `FC_NUM_RUNS=300` is the local exploration of the report.
        numRuns: Number(process.env.FC_NUM_RUNS ?? 50),
        ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
        verbose: 1,
      }
    );
  }, 600_000);
});
