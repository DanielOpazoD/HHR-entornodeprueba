import { createRequire } from 'node:module';
import { vi } from 'vitest';

/*
 * In-memory Firestore for the phase 1a server split (clinicalDerivedStore and its three callables).
 * Transactions buffer their writes, apply them on commit and, like the SDK, reject a read after
 * the first write. Every value is synthetic: no real patient, no real Firebase project.
 */

vi.mock('firebase-functions/v1', () => ({
  region: (...regions: string[]) => ({
    https: {
      onCall: (handler: (data: unknown, context: unknown) => unknown) => ({
        run: handler,
        regions,
      }),
    },
  }),
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;
      details?: unknown;

      constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.code = code;
        this.details = details;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
export const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');
export const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
export const store = require('../../../functions/lib/clinicalDerivedStore.js');

type Data = Record<string, unknown>;

export class FakeTimestamp {
  constructor(readonly millis: number) {}
  toDate(): Date {
    return new Date(this.millis);
  }
  toMillis(): number {
    return this.millis;
  }
}

const DELETE = Object.freeze({ fakeFieldValue: 'delete' });
export const FieldValue = { delete: () => DELETE };
export const Timestamp = { now: () => new FakeTimestamp(Date.now()) };

const clone = (value: unknown): unknown => {
  if (value instanceof FakeTimestamp || value === DELETE) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
};

const applyUpdate = (current: Data, update: Data): Data => {
  const next = clone(current) as Data;
  Object.entries(update).forEach(([path, value]) => {
    const parts = path.split('.');
    let cursor = next;
    parts.slice(0, -1).forEach(part => {
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part] as Data;
    });
    const last = parts[parts.length - 1];
    if (value === DELETE) delete cursor[last];
    else cursor[last] = clone(value);
  });
  return next;
};

export type Operation = { op: 'get' | 'set' | 'update' | 'create'; path: string };

export const createFakeFirestore = () => {
  const docs = new Map<string, Data>();
  const log: Operation[] = [];
  let autoId = 0;

  const docRef = (path: string): FakeDocRef => ({
    id: path.split('/').at(-1) as string,
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Data) => {
      log.push({ op: 'set', path });
      docs.set(path, clone(data) as Data);
    },
  });
  const collectionRef = (path: string) => ({
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    add: async (data: Data) => {
      autoId += 1;
      docs.set(`${path}/auto-${autoId}`, clone(data) as Data);
      return { id: `auto-${autoId}` };
    },
  });
  const snapshotOf = (path: string) => {
    const stored = docs.get(path);
    return {
      id: path.split('/').at(-1),
      exists: stored !== undefined,
      data: () => (stored === undefined ? undefined : (clone(stored) as Data)),
    };
  };

  const runTransaction = async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
    const writes: Array<() => void> = [];
    const write = (op: Operation['op'], ref: FakeDocRef, apply: () => void) => {
      log.push({ op, path: ref.path });
      writes.push(apply);
    };
    const transaction = {
      get: async (ref: FakeDocRef) => {
        if (writes.length > 0) throw new Error('Firestore transactions require all reads first.');
        log.push({ op: 'get', path: ref.path });
        return snapshotOf(ref.path);
      },
      set: (ref: FakeDocRef, data: Data) =>
        write('set', ref, () => docs.set(ref.path, clone(data) as Data)),
      create: (ref: FakeDocRef, data: Data) =>
        write('create', ref, () => {
          if (docs.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`);
          docs.set(ref.path, clone(data) as Data);
        }),
      update: (ref: FakeDocRef, data: Data) =>
        write('update', ref, () => {
          const current = docs.get(ref.path);
          if (!current) throw new Error(`NOT_FOUND: ${ref.path}`);
          docs.set(ref.path, applyUpdate(current, data));
        }),
    };
    const result = await callback(transaction);
    writes.forEach(apply => apply());
    return result;
  };

  return {
    docs,
    log,
    firestore: { collection: (name: string) => collectionRef(name), runTransaction },
    seed: (path: string, data: Data) => docs.set(path, clone(data) as Data),
    read: (path: string) => docs.get(path) as Data | undefined,
    paths: (prefix: string) => [...docs.keys()].filter(path => path.startsWith(prefix)).sort(),
    touched: (fragment: string) => log.filter(entry => entry.path.includes(fragment)),
    telemetry: () =>
      [...docs.entries()]
        .filter(([path]) => path.includes('/functionsTelemetry/'))
        .map(([, data]) => data as Data & { context: Data }),
  };
};

type FakeDocRef = {
  id: string;
  path: string;
  collection: (name: string) => unknown;
  get: () => Promise<unknown>;
  set: (data: Data) => Promise<void>;
};

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;

export const HOSPITAL = 'hospitals/hanga_roa';
export const DAY = '2026-11-02';
export const PRIOR_DAY = '2026-11-01';
export const dayPath = (date = DAY) => `${HOSPITAL}/dailyRecords/${date}`;
export const episodePath = (episodeId: string, date = DAY) =>
  `${dayPath(date)}/clinicalDerived/${episodeId}`;
export const POLICY_PATH = `${HOSPITAL}/settings/rayenImportPolicy`;
export const RUN_ID = 'run-synthetic-1';
export const SPLIT_ENV = 'HHR_CLINICAL_DERIVED_SPLIT_FROM';

export const vitals = (date: string, heartRate: number) => ({
  recordedDate: date,
  recordedAt: `${date} 08:00`,
  heartRate,
});
export const checkpoint = (watermark: string) => ({
  version: 1,
  sources: { vitals: { watermark } },
});

/** Mother in R1 with her newborn crib (distinct episodes), and a passport patient in R2. */
export const makeDay = (overrides: Data = {}, policy = { mode: 'preview', revision: 4 }): Data => ({
  date: DAY,
  lastUpdated: `${DAY}T10:00:00.000Z`,
  meta: { revision: 7 },
  beds: {
    R1: {
      bedId: 'R1',
      patientName: 'Madre Sintética',
      rut: '11.111.111-1',
      documentType: 'RUT',
      admissionDate: '2026-10-30',
      clinicalEpisodeId: 'ep_madre_1',
      isBlocked: false,
      vitalSigns: vitals('2026-11-01', 80),
      vitalSignsHistory: [vitals('2026-11-01', 80)],
      clinicalSyncCheckpoint: checkpoint('m-1'),
      clinicalCrib: {
        bedId: 'R1-cuna',
        patientName: 'RN Sintético',
        rut: 'XK1234567',
        documentType: 'Pasaporte',
        clinicalEpisodeId: 'ep_rn_1',
        vitalSignsHistory: [vitals('2026-11-01', 140)],
      },
    },
    R2: {
      bedId: 'R2',
      patientName: 'Paciente Pasaporte',
      rut: 'AB123456',
      documentType: 'Pasaporte',
      admissionDate: '2026-10-31',
      clinicalEpisodeId: 'ep_pasaporte_2',
      isBlocked: false,
      vitalSignsHistory: [vitals('2026-11-01', 70)],
      clinicalSyncCheckpoint: checkpoint('p-1'),
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  rayenSyncHistory: [
    {
      id: RUN_ID,
      status: 'applied',
      sourceDate: DAY,
      policy: { ...policy, clinicalBatchMode: 'shadow' },
    },
  ],
  ...overrides,
});

export const marker = (generation = 'gen-current') => ({ version: 1, generation });

export const episodeDoc = (episodeId: string, fields: Data, overrides: Data = {}): Data => ({
  schemaVersion: 1,
  date: DAY,
  clinicalEpisodeId: episodeId,
  layoutGeneration: 'gen-current',
  target: 'bed',
  bedId: 'R2',
  dayRevision: 7,
  lastMutationId: 'seed',
  ...fields,
  ...overrides,
});

export const shadowPolicy = {
  schemaVersion: 2,
  mode: 'preview',
  revision: 4,
  clinicalBatchMode: 'shadow',
};

export const makeContext = () => ({
  auth: { uid: 'synthetic-user', token: { email: 'enfermeria@example.com' } },
});

export const writeApi = (fake: FakeFirestore, role = 'nurse_hospital', withFieldValue = true) =>
  createDailyRecordWriteAuthorityFunctions({
    firestore: fake.firestore,
    Timestamp,
    ...(withFieldValue ? { FieldValue } : {}),
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

export const batchApi = (fake: FakeFirestore, role = 'nurse_hospital') =>
  createRayenClinicalEnrichmentFunctions({
    firestore: fake.firestore,
    Timestamp,
    FieldValue,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });

/** A guarded Rayen fill patch (modes `off`/`shadow`) for the run frozen in `makeDay`. */
export const guardedPatch = (patch: Data, overrides: Data = {}): Data => ({
  date: DAY,
  mode: 'shadow',
  expectedLastUpdated: `${DAY}T10:00:00.000Z`,
  patch,
  syncContract: { mutationId: 'mutation-patch-1', changedPaths: Object.keys(patch) },
  rayenClinicalWriteGuard: {
    runId: RUN_ID,
    importMode: 'preview',
    clinicalBatchMode: 'shadow',
    revision: 4,
    sourceDate: DAY,
    recordScope: 'run',
  },
  clientRuntimeContractVersion: 3,
  ...overrides,
});

/** The day's current `lastUpdated` as the ISO string a client sends back as its version. */
export const currentVersion = (fake: FakeFirestore, date = DAY): string => {
  const value = fake.read(dayPath(date))?.lastUpdated;
  return value instanceof FakeTimestamp ? value.toDate().toISOString() : String(value);
};
