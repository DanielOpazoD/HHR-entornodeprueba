/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
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
import { bedManagementReducer, type BedAction } from '@/hooks/useBedManagementReducer';
import { splitMixedClinicalStructuralPatch } from '@/hooks/controllers/bedManagementDispatchController';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

/**
 * Model-based test of this computer's save queue (W12-MODEL1, W12-MODEL2). fast-check draws
 * sequences of what people do (edit a day field or a bed's diagnosis with or without network, the
 * network coming back, the queue resending, another computer writing or changing a bed's patient,
 * this computer admitting or discharging one, a person signing in, out or over another, a page
 * reload) and runs them on the shipped code: the real repository, outbox, queue, transport,
 * session cleanup and the shipped authority handler, against the Firestore emulator. Some steps
 * run two actions at once, interleaved by `fc.scheduler()` at every send and answer: an edit
 * while the queue resends, and two tabs of the same person on the same day.
 * After every step the model checks the rules of docs/DOMAIN_RULES.md that hold for every
 * sequence (SAVE-01, SAVE-02, SAVE-03, Sesión, ID-01), and at the end, with the network back and
 * the queue run, that nothing is left waiting and a conflict stays only where another computer
 * changed one of its fields or the bed holds another patient. KNOWN_DEFECT marks the four rule
 * breaks W12-MODEL2 found, still open (the `it.fails` below); nothing after one in a sequence is
 * judged.
 * `FC_NUM_RUNS` / `FC_SEED` repeat or widen a run, as in src/tests/properties.
 */

// Bind SDK/auth per async writer; a mutable global DB would mix the two computers mid-write.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return {
    scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string; tab?: string }>(),
  };
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
const BED = 'R1';
const BED_PATH = `beds.${BED}.pathology` as const;
const PATHS = ['handoffNovedadesDayShift', 'handoffNovedadesNightShift', BED_PATH] as const;
type Path = (typeof PATHS)[number];
const short = (path: Path) => (path === BED_PATH ? 'cama' : path.slice(-8));
const PEOPLE = ['P1', 'P2'] as const;
type Person = (typeof PEOPLE)[number];
const ownerOf = (person: Person) => `user:synthetic-${person}`;
/** Synthetic patients only; one per admission of a sequence, so a name or RUT never repeats. */
const PATIENTS = [
  { rut: '11111111-1', documentType: 'RUT' },
  { rut: '10000013-K', documentType: 'RUT' },
  { rut: 'P123456785', documentType: 'Pasaporte' },
  { rut: '1234567A', documentType: 'Pasaporte' },
  { rut: '12A3456785', documentType: 'Pasaporte' },
] as const;
const baseRecord = () => {
  const record = DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    handoffNovedadesDayShift: 'DIA BASE',
    handoffNovedadesNightShift: 'NOCHE BASE',
    activeExtraBeds: [],
  });
  record.beds[BED] = DataFactory.createMockPatient(BED, {
    patientName: 'PACIENTE SINTETICO 0',
    rut: '12345678-5',
    documentType: 'RUT',
    admissionDate: date,
    firstSeenDate: date,
    clinicalEpisodeId: 'synthetic-episode-0',
    pathology: 'DIAGNOSTICO BASE',
  });
  return { ...record, meta: { revision: 1 } };
};
/**
 * Who the bed holds: patient and episode (ID-01). Empty when the bed is free. Each admission of a
 * sequence is another patient, and a readmission another episode; an episode id this computer
 * derives for a patient without one (`legacy_ep_…`) is not a new episode.
 */
const occupantOf = (record: DailyRecord | undefined): string => {
  const bed = record?.beds?.[BED];
  if (!bed || !String(bed.rut ?? '').trim()) return '';
  const episode = bed.clinicalEpisodeId?.startsWith('synthetic-') ? bed.clinicalEpisodeId : '';
  return `${bed.documentType ?? 'RUT'} ${bed.rut} ${episode} ${bed.admissionTime ?? ''}`.trim();
};

// ── The reference model (what a person may expect, whatever the code does) ──────────────────────
/** An edit this computer accepted: its unique text, who wrote it and the text it replaced. */
interface Edit {
  value: string;
  path: Path;
  owner: string;
  generation: string | null;
  base: unknown;
  /** For the bed: the patient and episode the person saw when writing. */
  occupant: string;
  /** Written over its own unsent edit whose base another computer changed (`isOverStaleBase`). */
  overStaleBase: boolean;
}
interface Model {
  online: boolean;
  person: Person | null;
  edits: Edit[];
  server: Record<Path, unknown>;
  occupant: string;
  everOnServer: Set<unknown>;
  count: number;
  admissions: number;
  log: string[];
  /** The sequence reached KNOWN_DEFECT; nothing after it is judged. */
  reachedKnownDefect: boolean;
}
const newModel = (): Model => ({
  online: true,
  person: 'P1',
  edits: [],
  server: {
    handoffNovedadesDayShift: 'DIA BASE',
    handoffNovedadesNightShift: 'NOCHE BASE',
    [BED_PATH]: 'DIAGNOSTICO BASE',
  },
  occupant: occupantOf(baseRecord()),
  everOnServer: new Set(['DIA BASE', 'NOCHE BASE', 'DIAGNOSTICO BASE']),
  count: 0,
  admissions: 0,
  log: [],
  reachedKnownDefect: false,
});
const editOf = (m: Model, value: unknown) => m.edits.find(edit => edit.value === value);
/** The texts an edit was written over: its base, the base of that one if it was ours, and so on. */
const replacedBy = (m: Model, edit: Edit): unknown[] => {
  const chain: unknown[] = [];
  for (let base: unknown = edit.base; ; ) {
    chain.push(base);
    const previous = editOf(m, base);
    if (!previous || previous.path !== edit.path) return chain;
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
      later.path === edit.path &&
      later.occupant === edit.occupant
  );
/** A queued day write that holds a bed edit next to a day field: see KNOWN_DEFECT 2. */
const mixesBedAndDay = (task: SyncTask) =>
  [...(task.syncContract?.changedPaths ?? []), ...Object.keys(task.patchBaseValues ?? {})].some(
    path => path.startsWith('beds.')
  );
const heldBy = (tasks: SyncTask[], edit: Edit) =>
  tasks.filter(
    task => task.ownerKey === edit.owner && getValueAtPath(task.payload, edit.path) === edit.value
  );
/** Successful bed patches whose committed revision was not the one they were written on (#1603). */
const bedBaseViolations: string[] = [];

/** Every rule, after every step. Each failure names the rule and the sequence so far. */
const checkRules = async (m: Model, step: string) => {
  m.log.push(step);
  if (m.reachedKnownDefect) return;
  const fail = (rule: string, detail: string): never => {
    throw new Error(`${rule}: ${detail}\nPasos: ${m.log.join(' → ')}`);
  };
  const server = await readServer();
  const tasks = await hospitalDB.syncQueue.toArray();
  const owner = m.person ? ownerOf(m.person) : null;
  const occupant = occupantOf(server);
  // Camas (#1603): a bed patch commits only on the revision it was written on.
  if (bedBaseViolations.length > 0) fail('Versión base de cama', bedBaseViolations.join('; '));
  for (const path of PATHS) {
    const before = m.server[path];
    const now = getValueAtPath(server, path);
    const edit = editOf(m, now);
    // ID-01: a bed edit is only ever applied to the patient and episode it was written for.
    if (path === BED_PATH && edit && edit.occupant !== occupant) {
      // KNOWN_DEFECT 3: a diagnosis written over an empty one.
      if (edit.base === '') {
        m.log.push('[KNOWN_DEFECT]');
        m.reachedKnownDefect = true;
        return;
      }
      fail('ID-01', `«${String(now)}», escrito para ${edit.occupant}, quedó en ${occupant}`);
    }
    // The other computer writes over the server's current text by construction; '' is a bed
    // emptied or admitted, which clears the diagnosis.
    if (now === before || (typeof now === 'string' && (now === '' || now.startsWith('A'))))
      continue;
    // SAVE-02: a text reaches the server only over the text its writer saw (no lost update).
    if (!edit || !replacedBy(m, edit).includes(before)) {
      // KNOWN_DEFECT 1 and 4.
      if (edit?.overStaleBase) {
        m.log.push('[KNOWN_DEFECT]');
        m.reachedKnownDefect = true;
        return;
      }
      return fail(
        'SAVE-02',
        `${short(path)}: «${String(before)}» reemplazado por «${String(now)}» sin verlo`
      );
    }
    // Sesión: nothing is published for a session that is no longer the current one.
    if (edit.owner !== owner || edit.generation !== getSessionGeneration())
      fail(
        'Sesión',
        `«${String(now)}», escrito en otra sesión de ${edit.owner}, se publicó en la de ${owner}`
      );
  }
  for (const path of PATHS) {
    m.server[path] = getValueAtPath(server, path);
    m.everOnServer.add(m.server[path]);
  }
  m.occupant = occupant;
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

// ── The shipped code, two computers, two tabs and the emulator ───────────────────────────────────
let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
let deviceA: { db: unknown; uid: string; role: string };
let deviceB: { db: { disableNetwork(): Promise<void>; enableNetwork(): Promise<void> } };
let skew = 0;
const realNow = Date.now.bind(Date);
/** One browser tab of computer B: its own module graph (memory, write lock, session). */
interface Tab {
  name: string;
  updatePartialDetailed: typeof updatePartialDetailed;
  captureAuthoringSession: typeof captureAuthoringSession;
  processSyncQueue: typeof processSyncQueue;
  reconcileAuthorizedSessionOwner: typeof reconcileAuthorizedSessionOwner;
  setSessionGeneration: typeof setSessionGeneration;
  setFirestoreSyncState: typeof setFirestoreSyncState;
  setFirestoreEnabled: typeof setFirestoreEnabled;
}
const tab1: Tab = {
  name: 'pestaña 1',
  updatePartialDetailed,
  captureAuthoringSession,
  processSyncQueue,
  reconcileAuthorizedSessionOwner,
  setSessionGeneration,
  setFirestoreSyncState,
  setFirestoreEnabled,
};
let tab2: Tab;
const onB = <T>(person: Person | null, action: () => T, tab = tab1): T =>
  scope.run(
    {
      db: deviceB.db,
      uid: person ? `synthetic-${person}` : '',
      role: 'nurse_hospital',
      tab: tab.name,
    },
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

// ── Interleavings: every send and every answer waits for the scheduler of a step that has one ──
let scheduler: fc.Scheduler | null = null;
const gated =
  <A extends unknown[], R>(label: string, run: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    const who = scope.getStore()?.tab ?? 'otro equipo';
    if (scheduler) await scheduler.schedule(Promise.resolve(), `${who}: ${label} envía`);
    const outcome = await run(...args).then(
      value => ({ value }),
      (error: unknown) => ({ error })
    );
    if (scheduler) await scheduler.schedule(Promise.resolve(), `${who}: ${label} responde`);
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  };
/** Runs actions at once; fast-check orders their sends and answers and can replay the order. */
const together = async (s: fc.Scheduler, actions: (() => Promise<unknown>)[]) => {
  scheduler = s;
  try {
    const results = await s.waitFor(Promise.allSettled(actions.map(action => action())));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw (failure as PromiseRejectedResult).reason;
  } finally {
    scheduler = null;
  }
};

type Command = fc.AsyncCommand<Model, object>;
const command = (
  name: string,
  check: (m: Model) => boolean,
  run: (m: Model) => Promise<string | void>,
  describe: () => string = () => name
): Command => ({
  check,
  run: async m => checkRules(m, (await run(m)) ?? name),
  toString: describe,
});

/** The census's own patch for a bed action, split as the census sends it (structural first). */
const bedPatches = (record: DailyRecord, action: BedAction): DailyRecordPatch[] => {
  const patch = bedManagementReducer(record, action) ?? {};
  const split = splitMixedClinicalStructuralPatch(patch);
  return split ? [split.structural, split.clinical] : [patch];
};
const patchOf = (record: DailyRecord, path: Path, value: string): DailyRecordPatch[] =>
  path === BED_PATH
    ? bedPatches(record, { type: 'UPDATE_PATIENT', bedId: BED, field: 'pathology', value })
    : [{ [path]: value } as DailyRecordPatch];
const admissionOf = (m: Model): Partial<PatientData> => {
  const patient = PATIENTS[m.admissions++];
  return {
    patientName: `PACIENTE SINTETICO ${m.admissions}`,
    rut: patient.rut,
    documentType: patient.documentType,
    admissionDate: date,
    age: '40',
  };
};

/**
 * An unsent edit of this field waits in the queue over a base the server no longer holds: another
 * computer changed the field. KNOWN_DEFECT 1 and 4 start here; the exact cases are the `it.fails`
 * below, and the first test keeps the one #1637 fixed.
 */
const isOverStaleBase = async (path: Path, owner: string) => {
  const stored = getValueAtPath(await readServer(), path);
  return (await hospitalDB.syncQueue.toArray()).some(
    task =>
      task.ownerKey === owner &&
      (task.syncContract?.changedPaths ?? []).includes(path) &&
      task.patchBaseValues?.[path] !== stored
  );
};

/** One person edits one field in one tab; the edit enters the model if this computer took it. */
const editIn = async (m: Model, path: Path, tab = tab1): Promise<string> => {
  const person = m.person as Person;
  if (tab !== tab1)
    await onB(person, () => tab.reconcileAuthorizedSessionOwner(ownerOf(person)), tab);
  const local = await hospitalDB.dailyRecords.get(date);
  if (!local) return `editar ${short(path)} (día no cargado)`;
  const occupant = occupantOf(local);
  if (path === BED_PATH && !occupant) return 'editar cama (vacía)';
  const value = `B${++m.count}`;
  const overStaleBase = await isOverStaleBase(path, ownerOf(person));
  const authoringSession = tab.captureAuthoringSession();
  let saved: Awaited<ReturnType<typeof updatePartialDetailed>> | undefined;
  let refusal = 'rechazada';
  try {
    for (const patch of patchOf(local, path, value)) {
      const baseRecord = (await hospitalDB.dailyRecords.get(date)) ?? local;
      const result = await onB(
        person,
        () => tab.updatePartialDetailed(date, patch, { authoringSession, baseRecord }),
        tab
      );
      if (path in patch) saved = result;
    }
  } catch (error) {
    // The census shows the refusal, e.g. «Otra pestaña cambió este dato» between two tabs.
    refusal = `rechazada: ${(error as Error).message}`;
  }
  // A bed edit commits on the server first: a refused local save may still have published it.
  const stored = getValueAtPath(await readServer(), path);
  if (!saved?.savedLocally && stored !== value) return `editar ${value} (${refusal})`;
  const edit = {
    value,
    path,
    base: getValueAtPath(local, path),
    owner: ownerOf(person),
    generation: authoringSession.generation,
    occupant: path === BED_PATH ? occupant : '',
    overStaleBase,
  };
  m.edits.push(edit);
  // SAVE-01: «guardado» only when the server holds it, or a later edit of this step replaced it.
  const replacedNow = editOf(m, stored);
  if (saved?.updatedRemotely && stored !== value && !(replacedNow && replacedNow.path === path))
    throw new Error(`SAVE-01: «${value}» se informó guardado sin estar en el servidor`);
  return `${tab === tab1 ? '' : `${tab.name}: `}editar ${value} en ${short(path)}${m.online ? '' : ' sin red'}`;
};
const replayIn = async (m: Model, tab = tab1) => {
  const person = m.person as Person;
  if (tab !== tab1)
    await onB(person, () => tab.reconcileAuthorizedSessionOwner(ownerOf(person)), tab);
  // Past any retry wait or pre-outbox hold; the clock only moves forward.
  skew += 10 * 60_000;
  await onB(person, () => tab.processSyncQueue(), tab);
};

const editOnB = (path: Path) =>
  command(
    `editar ${short(path)}`,
    m => m.person !== null,
    m => editIn(m, path)
  );
/** Another computer A, always over the server's current day. */
const onA = async (patch: DailyRecordPatch, extra: object = {}) => {
  const current = await readServer();
  await scope.run(deviceA, () =>
    writes.updateRecordPartial(date, patch, current.lastUpdated, {
      historyPolicy: 'skip',
      baseRecord: current,
      syncContract: {
        mutationId: `synthetic-A-${realNow()}-${Math.random()}`,
        baseRevision: resolveRecordBaseRevision(current),
        changedPaths: Object.keys(patch),
      },
      ...extra,
    })
  );
};
const writeOnA = (path: Path) =>
  command(
    `otro equipo escribe ${short(path)}`,
    m => path !== BED_PATH || m.occupant !== '',
    async m => {
      const value = `A${++m.count}`;
      for (const patch of patchOf(await readServer(), path, value)) await onA(patch);
      return `otro equipo escribe ${value} en ${short(path)}`;
    }
  );
/** A discharges the bed's patient and admits another (ID-01: the bed is only a location). */
const replaceOnA = command(
  'otro equipo cambia el paciente de la cama',
  m => m.occupant !== '' && m.admissions < PATIENTS.length,
  async m => {
    const current = await readServer();
    for (const patch of bedPatches(current, { type: 'CLEAR_PATIENT', bedId: BED }))
      await onA(patch, {
        intentionalBedClear: {
          bedId: BED,
          confirmedLastUpdated: current.lastUpdated,
          confirmedOccupant: buildConfirmedBedOccupantIdentity(current.beds[BED]),
        },
      });
    const fields = admissionOf(m);
    for (const action of [{ type: 'UPDATE_PATIENT_MULTIPLE', bedId: BED, fields }] as const)
      for (const patch of bedPatches(await readServer(), action)) await onA(patch);
  }
);
/** Eloísa, through the server, readmits the same patient as a new episode (ID-02). */
const readmitOnServer = command(
  'el servidor reingresa al paciente con otro episodio',
  m => m.occupant !== '',
  async m => {
    await admin.doc(dayPath).update({
      [`beds.${BED}.clinicalEpisodeId`]: `synthetic-episode-${++m.count}`,
      [`beds.${BED}.admissionTime`]: '23:59',
      [`beds.${BED}.pathology`]: '',
      'meta.revision': FieldValue.increment(1),
      lastUpdated: new Date(Date.now()).toISOString(),
    });
  }
);
/** This computer discharges the bed's patient, as the census row does (server first). */
const dischargeOnB = command(
  'egresar al paciente de la cama',
  m => m.online && m.person !== null,
  async m => {
    const local = await hospitalDB.dailyRecords.get(date);
    if (!local || !occupantOf(local)) return 'egresar (cama vacía)';
    const authoringSession = captureAuthoringSession();
    const outcomes: string[] = [];
    for (const patch of bedPatches(local, { type: 'CLEAR_PATIENT', bedId: BED }))
      outcomes.push(
        await onB(m.person, () =>
          updatePartialDetailed(date, patch, {
            authoringSession,
            baseRecord: local,
            optimisticRemoteConfirmed: true,
            intentionalBedClear: {
              bedId: BED,
              confirmedLastUpdated: local.lastUpdated,
              confirmedOccupant: buildConfirmedBedOccupantIdentity(local.beds[BED]),
            },
          })
        ).then(
          result => (result.updatedRemotely ? 'egresado' : result.outcome),
          // The census shows the refusal and keeps the patient; the bed stays as it was.
          (error: unknown) => `rechazado: ${(error as Error).message}`
        )
      );
    return `egresar al paciente de la cama (${outcomes.join(', ')})`;
  }
);
/** This computer admits a patient in the empty bed, as the admission form does. */
const admitOnB = command(
  'ingresar un paciente en la cama',
  m => m.person !== null && m.admissions < PATIENTS.length,
  async m => {
    const local = await hospitalDB.dailyRecords.get(date);
    if (!local || occupantOf(local)) return 'ingresar (cama ocupada)';
    const authoringSession = captureAuthoringSession();
    const fields = admissionOf(m);
    const action = { type: 'UPDATE_PATIENT_MULTIPLE', bedId: BED, fields } as const;
    try {
      for (const patch of bedPatches(local, action)) {
        const baseRecord = (await hospitalDB.dailyRecords.get(date)) ?? local;
        await onB(m.person, () =>
          updatePartialDetailed(date, patch, { authoringSession, baseRecord })
        );
      }
    } catch (error) {
      // The form shows the refusal and the bed stays empty.
      return `ingresar a ${fields.patientName} (rechazado: ${(error as Error).message})`;
    }
    return `ingresar a ${fields.patientName}${m.online ? '' : ' sin red'}`;
  }
);
const network = (online: boolean) =>
  command(
    online ? 'vuelve la red' : 'se corta la red',
    m => m.online !== online,
    async m => {
      m.online = online;
      // As the app does when the browser reports it (buildAuthRemoteSyncState).
      for (const tab of [tab1, tab2])
        tab.setFirestoreSyncState(
          online ? { mode: 'enabled', reason: 'ready' } : { mode: 'local_only', reason: 'offline' }
        );
      await (online ? deviceB.db.enableNetwork() : deviceB.db.disableNetwork());
    }
  );
const replay = command(
  'reenvío de la cola',
  m => m.online && m.person !== null,
  async m => {
    await replayIn(m);
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
/** Two actions of the same person at once, in an order fast-check draws and can shrink. */
const interleaved = (
  name: string,
  check: (m: Model) => boolean,
  actions: (m: Model) => (() => Promise<unknown>)[]
) =>
  fc.scheduler().map(s =>
    command(
      name,
      check,
      async m => {
        const steps: string[] = [];
        await together(
          s,
          actions(m).map(action => async () => steps.push(String(await action())))
        );
        return `${name} [${steps.join(' | ')}]`;
      },
      () =>
        `${name} ${s
          .report()
          .map(task => task.label)
          .join(' → ')}`
    )
  );
const pathArb = fc.constantFrom(...PATHS);
const editDuringReplay = pathArb.chain(path =>
  interleaved(
    `editar ${short(path)} mientras la cola reenvía`,
    m => m.online && m.person !== null,
    m => [() => editIn(m, path), () => replayIn(m).then(() => 'reenvío')]
  )
);
const twoTabsEdit = fc.tuple(pathArb, pathArb).chain(([first, second]) =>
  interleaved(
    `dos pestañas editan ${short(first)} y ${short(second)}`,
    m => m.person !== null,
    m => [() => editIn(m, first), () => editIn(m, second, tab2)]
  )
);
const otherTabReplays = pathArb.chain(path =>
  interleaved(
    `editar ${short(path)} mientras la otra pestaña reenvía`,
    m => m.online && m.person !== null,
    m => [() => editIn(m, path), () => replayIn(m, tab2).then(() => 'pestaña 2: reenvío')]
  )
);
/** Weighted toward what fills a queue: editing and resending. */
const commands = [
  ...PATHS.flatMap(path => Array(2).fill(fc.constant(editOnB(path)))),
  ...PATHS.map(path => fc.constant(writeOnA(path))),
  fc.constant(replaceOnA),
  fc.constant(readmitOnServer),
  fc.constant(dischargeOnB),
  fc.constant(admitOnB),
  fc.constant(network(false)),
  fc.constant(network(true)),
  fc.constant(replay),
  fc.constant(refresh),
  editDuringReplay,
  twoTabsEdit,
  otherTabReplays,
  ...PEOPLE.map(person => fc.constant(signIn(person))),
  fc.constant(signOut),
  fc.constant(reload),
];

/**
 * At the end the network is back and the queue has run: nothing of the current session is left
 * waiting, and a conflict is kept only where someone else changed one of its fields or the bed
 * no longer holds the patient its edit was written for.
 */
const checkSettledAfterDrain = async (m: Model) => {
  if (m.reachedKnownDefect) return;
  if (!m.online) await network(true).run(m, {});
  if (!m.person) await signIn('P1').run(m, {});
  for (let round = 0; round < 3; round++) await replay.run(m, {});
  if (m.reachedKnownDefect) return;
  const server = await readServer();
  const owner = ownerOf(m.person as Person);
  for (const task of await hospitalDB.syncQueue.toArray()) {
    if (task.ownerKey !== owner || task.lastErrorCode === 'session_owner_logged_out') continue;
    const explained = m.edits.some(edit => {
      if (getValueAtPath(task.payload, edit.path) !== edit.value) return false;
      const stored = getValueAtPath(server, edit.path);
      const changedElsewhere = stored !== edit.value && !replacedBy(m, edit).includes(stored);
      return changedElsewhere || (edit.path === BED_PATH && edit.occupant !== occupantOf(server));
    });
    if (task.status === 'CONFLICT' && explained) continue;
    // KNOWN_DEFECT 2.
    if (task.status === 'CONFLICT' && mixesBedAndDay(task)) {
      m.log.push('[KNOWN_DEFECT]');
      m.reachedKnownDefect = true;
      return;
    }
    throw new Error(
      `Al terminar: tarea ${task.status} (${task.lastErrorCode ?? 'sin código'}) de ${owner} ` +
        `sin un cambio ajeno que la explique\nPasos: ${m.log.join(' → ')}`
    );
  }
};

/** A fresh census, an empty queue and P1 signed in on computer B. */
const resetWorld = async () => {
  // The clock moves forward within a sequence; across hundreds of them it would leave the day's
  // 48-hour nurse editing window that the shipped handler checks.
  skew = 0;
  await deviceB.db.enableNetwork();
  for (const tab of [tab1, tab2]) tab.setFirestoreEnabled(true);
  await env.clearFirestore();
  await onB(null, () => clearSessionScopedClientState('manual')).catch(() => undefined);
  tab2.setSessionGeneration(null);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  localStorage.clear();
  bedBaseViolations.length = 0;
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
    const patchAuthority = gated(
      'autoridad',
      async (
        payload: Parameters<typeof authority.patchDailyRecordWithClinicalAuthorityCallable>[0]
      ) => {
        const result = await api.patchDailyRecordWithClinicalAuthority.run(payload, context());
        const base = payload.syncContract?.baseRevision;
        const touchesBed = Object.keys(payload.patch ?? {}).some(path => path.startsWith('beds.'));
        const revision = (result as { revision?: number } | undefined)?.revision;
        if (
          touchesBed &&
          typeof base === 'number' &&
          typeof revision === 'number' &&
          revision > base + 1
        )
          bedBaseViolations.push(`revisión ${revision} sobre base ${base}`);
        return result;
      }
    );
    const saveAuthority = gated(
      'autoridad',
      async (
        payload: Parameters<typeof authority.saveDailyRecordWithClinicalAuthorityCallable>[0]
      ) => api.saveDailyRecordWithClinicalAuthority.run(payload, context())
    );
    // Each tab is its own module graph (memory, write lock, session) over one IndexedDB, as two
    // browser tabs are. The database and the stateless outbox helpers that the code imports on
    // demand stay one instance: a copy loaded after the reset would open a transaction on another
    // database object than the one of the tab that called it.
    const shared = {
      '@/services/storage/indexeddb/indexedDbCore':
        await import('@/services/storage/indexeddb/indexedDbCore'),
      '@/services/storage/sync/dexieDailyRecordOutbox':
        await import('@/services/storage/sync/dexieDailyRecordOutbox'),
      '@/services/storage/sync/dexieSyncQueueAuthorityAck':
        await import('@/services/storage/sync/dexieSyncQueueAuthorityAck'),
      '@/services/storage/sessionSyncQueuePreservation':
        await import('@/services/storage/sessionSyncQueuePreservation'),
    };
    vi.resetModules();
    for (const [id, module] of Object.entries(shared)) vi.doMock(id, () => module);
    const second = {
      repo: await import('@/services/repositories/dailyRecordRepositoryWriteService'),
      session: await import('@/services/storage/authoringSession'),
      sync: await import('@/services/storage/sync'),
      scoped: await import('@/services/storage/sessionScopedStorageService'),
      transition: await import('@/services/storage/sessionStorageTransition'),
      config: await import('@/services/repositories/repositoryConfig'),
      authority: await import('@/services/storage/firestore/dailyRecordAuthorityCallableClient'),
      writes: await import('@/services/storage/firestore/firestoreRecordWrites'),
    };
    tab2 = {
      name: 'pestaña 2',
      updatePartialDetailed: second.repo.updatePartialDetailed,
      captureAuthoringSession: second.session.captureAuthoringSession,
      processSyncQueue: second.sync.processSyncQueue,
      reconcileAuthorizedSessionOwner: second.scoped.reconcileAuthorizedSessionOwner,
      setSessionGeneration: second.transition.setSessionGeneration,
      setFirestoreSyncState: second.config.setFirestoreSyncState,
      setFirestoreEnabled: second.config.setFirestoreEnabled,
    };
    for (const [callable, recordWrites] of [
      [authority, writes],
      [second.authority, second.writes],
    ] as const) {
      // Only the callable transport is replaced: the shipped handler runs its real admin transaction.
      vi.spyOn(callable, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
        async payload => {
          try {
            return await patchAuthority(payload);
          } catch (error) {
            throw callable.normalizeDailyRecordAuthorityError(error);
          }
        }
      );
      vi.spyOn(callable, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
        async payload => {
          try {
            return await saveAuthority(payload);
          } catch (error) {
            throw callable.normalizeDailyRecordAuthorityError(error);
          }
        }
      );
      const direct = recordWrites.updateRecordPartial;
      vi.spyOn(recordWrites, 'updateRecordPartial').mockImplementation(gated('envío', direct));
    }
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
    const edit = async (field: Path, value: string) => {
      const local = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      return onB('P1', () =>
        updatePartialDetailed(date, { [field]: value } as DailyRecordPatch, {
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
        updatePartialDetailed(date, { [night]: value } as DailyRecordPatch, {
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

  // The counterexamples of W12-MODEL2 (KNOWN_DEFECT), shrunk to one tab; open, their fix goes
  // apart. 1 and 2 come from a bed edit joining the day's queued write of an unsent day field.
  // KNOWN_DEFECT 1: the bed edit the server confirms moves that write's version to the server's
  // current one, which already holds the other computer's text, while its field keeps the older
  // base. The next edit of the field meets that same version, skips the per-field check and
  // replaces the other computer's text, which nobody here saw, reported as saved (SAVE-02).
  it.fails(
    'keeps the other computer’s text when a bed edit follows an unsent edit of the same field',
    async () => {
      const m = await resetWorld();
      const night = 'handoffNovedadesNightShift';
      await network(false).run(m, {});
      expect(await editIn(m, night)).toBe('editar B1 en ghtShift sin red');
      await writeOnA(night).run(m, {});
      await network(true).run(m, {});
      expect(await editIn(m, BED_PATH)).toBe('editar B3 en cama');
      expect((await readServer()).beds[BED].pathology).toBe('B3');

      expect(await editIn(m, night)).toBe('editar B4 en ghtShift');
      expect((await readServer())[night]).toBe('A2');
    },
    60_000
  );

  // KNOWN_DEFECT 2: a bed diagnosis edited without network joins the queued day write, which then
  // needs its exact base version, as bed fields do. This computer's own next save moves the
  // version, so the queue keeps both edits as a conflict («una versión más reciente») that nobody
  // else caused, and they never reach the server (SAVE-02: different fields keep both changes).
  it.fails(
    'publishes an offline day note and diagnosis after this computer saves another field',
    async () => {
      const m = await resetWorld();
      await network(false).run(m, {});
      expect(await editIn(m, 'handoffNovedadesDayShift')).toBe('editar B1 en DayShift sin red');
      expect(await editIn(m, BED_PATH)).toBe('editar B2 en cama sin red');
      await network(true).run(m, {});
      expect(await editIn(m, 'handoffNovedadesNightShift')).toBe('editar B3 en ghtShift');
      for (let round = 0; round < 3; round++) await replayIn(m);

      const server = await readServer();
      expect(server.handoffNovedadesDayShift).toBe('B1');
      expect(server.beds[BED].pathology).toBe('B2');
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    },
    60_000
  );

  // KNOWN_DEFECT 3 (ID-01): this computer still shows a patient without a diagnosis when another
  // computer discharges them and admits another, also without one. A diagnosis written here meets
  // the newer version; its retry checks only that the diagnosis still holds its base value, which
  // the new patient's empty one does, and writes it on the new patient, reported as saved.
  it.fails(
    'never writes a diagnosis meant for the patient shown here on the patient admitted meanwhile',
    async () => {
      const m = await resetWorld();
      for (const patch of patchOf(await readServer(), BED_PATH, '')) await onA(patch);
      await refresh.run(m, {});
      await replaceOnA.run(m, {});
      expect((await readServer()).beds[BED].rut).toBe('11111111-1');

      expect(await editIn(m, BED_PATH)).toBe('editar B1 en cama');
      expect((await readServer()).beds[BED].pathology).toBe('');
    },
    60_000
  );

  // KNOWN_DEFECT 4: the defect #1637 fixed for day fields, still open for a bed field. The
  // diagnosis written here meets the other computer's and gets the «changed elsewhere» notice; the
  // day kept here takes the server's version, so the next diagnosis replaces the other computer's
  // unseen (SAVE-02).
  it.fails(
    'keeps the other computer’s diagnosis when a second edit follows a «changed elsewhere» notice',
    async () => {
      const m = await resetWorld();
      await writeOnA(BED_PATH).run(m, {});
      expect(await editIn(m, BED_PATH)).toBe('editar B2 en cama');
      expect((await readServer()).beds[BED].pathology).toBe('A1');

      expect(await editIn(m, BED_PATH)).toBe('editar B3 en cama');
      expect((await readServer()).beds[BED].pathology).toBe('A1');
    },
    60_000
  );

  it('keeps every rule after every step of random sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 16, size: '+1' }), async sequence => {
        const m = await resetWorld();
        await fc.asyncModelRun(() => ({ model: m, real: {} }), sequence);
        await checkSettledAfterDrain(m);
      }),
      {
        // About 15 s on a laptop; `FC_NUM_RUNS=300` is the local exploration of the report.
        numRuns: Number(process.env.FC_NUM_RUNS ?? 30),
        ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
        verbose: 1,
      }
    );
  }, 600_000);
});
