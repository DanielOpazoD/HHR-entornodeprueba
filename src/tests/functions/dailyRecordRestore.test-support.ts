import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const {
  createDailyRecordRestoreFunctions,
} = require('../../../functions/lib/dailyRecordRestoreFunctions.js');
export const {
  createDailyRecordPitrReader,
} = require('../../../functions/lib/dailyRecordRestoreSource.js');
export const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');
export const { Timestamp } = require('../../../functions/lib/appContext.js');
export type Data = Record<string, unknown>;
export const DATE = '2026-11-01';
export const NOW = Date.parse('2026-11-01T16:00:00Z');
export const DAY = 'hospitals/hanga_roa/dailyRecords/' + DATE;
export const CONTEXT = { auth: { uid: 'synthetic-admin', token: { email: 'admin@example.com' } } };
export const record = () => ({
  date: DATE,
  beds: {
    R1: {
      patientName: 'Paciente sintético',
      rut: 'PAS-123',
      documentType: 'Pasaporte',
      clinicalEpisodeId: 'episode-1',
      cudyr: { category: 'C1' },
      clinicalCrib: { patientName: 'RN sintético', clinicalEpisodeId: 'episode-rn' },
    },
  },
  discharges: [{ id: 'd1', patientName: 'Alta sintética', time: '12:00' }],
  transfers: [],
  cma: [],
  lastUpdated: '2026-11-01T15:30:00.000Z',
  meta: { revision: 10 },
  cudyrLocked: true,
  clinicalDerivedLayout: { version: 1, generation: 'original' },
});
export const episode = (id = 'episode-1') => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId: id,
  layoutGeneration: 'original',
  dayRevision: 10,
  updatedAt: Timestamp.fromMillis(NOW - 1800000),
  vitalSignsHistory: [{ pulse: 80 }],
});
interface Ref {
  path: string;
  id: string;
  collection: (name: string) => Collection;
}
interface Collection {
  path: string;
  doc: (id?: string) => Ref;
}
type Write = { ref: Ref; data: Data; create: boolean };
export const harness = (role = 'admin') => {
  const docs = new Map<string, Data>([
    [DAY, record()],
    [`${DAY}/clinicalDerived/episode-1`, episode()],
  ]);
  let seq = 0;
  const log: { path: string; data: Data }[] = [];
  let failWrite = '';
  let beforeCommit: (() => void) | undefined;
  const collection = (path: string): Collection => ({
    path,
    doc: (id = `auto-${++seq}`): Ref => ({
      id,
      path: `${path}/${id}`,
      collection: name => collection(`${path}/${id}/${name}`),
    }),
  });
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: docs.has(path),
    data: () => docs.get(path),
  });
  const firestore = {
    collection,
    runTransaction: async <T>(
      run: (tx: unknown) => Promise<T>,
      options?: { readOnly: boolean }
    ) => {
      // Serial synthetic transaction, including an injected concurrent write and retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        const writes: Write[] = [];
        const tx = {
          get: async (ref: Ref | Collection) => {
            if (writes.length) throw new Error('read after write');
            if ('id' in ref) return snapshot(ref.path);
            return {
              docs: [...docs.keys()]
                .filter(
                  path =>
                    path.startsWith(ref.path + '/') &&
                    !path.substring(ref.path.length + 1).includes('/')
                )
                .map(snapshot),
            };
          },
          set: (ref: Ref, data: Data) => writes.push({ ref, data, create: false }),
          create: (ref: Ref, data: Data) => writes.push({ ref, data, create: true }),
        };
        const result = await run(tx);
        if (beforeCommit && !options?.readOnly) {
          const concurrent = beforeCommit;
          beforeCommit = undefined;
          concurrent();
          continue;
        }
        if (writes.some(write => write.ref.path.includes(failWrite)) && failWrite)
          throw new Error('synthetic commit failure');
        if (writes.some(write => write.create && docs.has(write.ref.path)))
          throw new Error('already exists');
        for (const write of writes) {
          docs.set(write.ref.path, write.data);
          log.push({ path: write.ref.path, data: write.data });
        }
        return result;
      }
      throw new Error('transaction retry exhausted');
    },
  };
  const historical = {
    record: { ...record(), lastUpdated: '2026-11-01T14:00:00.000Z', meta: { revision: 3 } },
    docs: [
      {
        id: 'episode-1',
        data: { ...episode(), dayRevision: 3, vitalSignsHistory: [{ pulse: 65 }] },
      },
    ],
  };
  let reads = 0;
  let historicalError = false;
  const api = createDailyRecordRestoreFunctions({
    firestore,
    Timestamp,
    resolveRoleForEmail: async () => role,
    clock: () => NOW,
    readHistorical: async () => {
      reads++;
      if (historicalError) throw new Error('synthetic read failure');
      return historical;
    },
  });
  const source = { date: DATE, readTime: '2026-11-01T14:00:00.000Z' };
  const request = { ...source, expectedLastUpdated: record().lastUpdated, confirmationDate: DATE };
  return {
    docs,
    log,
    firestore,
    historical,
    api,
    source,
    request,
    reads: () => reads,
    failRead: () => {
      historicalError = true;
    },
    failCommit: (path: string) => {
      failWrite = path;
    },
    concurrent: (write: () => void) => {
      beforeCommit = write;
    },
  };
};
