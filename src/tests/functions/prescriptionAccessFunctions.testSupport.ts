import { createRequire } from 'node:module';
import { afterEach, beforeEach, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const prescriptionAccess = require('../../../functions/lib/prescriptionAccessFunctions.js');

export const {
  createValidatePinHandler,
  createListUploadPatientOptionsHandler,
  createListUploadReadonlyRecordsHandler,
  createSubmitHandler,
  createSetPinHandler,
  hashPin,
  hashPinLegacySha256,
  generatePinSalt,
  computeExpiresAt,
  resolveUploadPatientOptionForExactDate,
} = prescriptionAccess;

interface FakeFirestoreDoc {
  data: Record<string, unknown> | null;
}

export const buildAdminHarness = (
  harnessOptions: {
    failPrescriptionWrite?: boolean;
    dailyRecords?: Record<string, Record<string, unknown>>;
    prescriptionRecords?: Record<string, Record<string, unknown>>;
  } = {}
) => {
  const accessConfig: FakeFirestoreDoc = { data: null };
  const uploadQuota: FakeFirestoreDoc = { data: null };
  const writtenPrescriptions: Record<string, Record<string, unknown>> = {
    ...(harnessOptions.prescriptionRecords || {}),
  };
  const recordedPrescriptionQueries: Array<{ field: string; op: string; value: unknown }> = [];
  const storedBlobs: Record<string, Buffer> = {};
  const dailyRecords = harnessOptions.dailyRecords || {};

  const docStoreForPath = (path: string): FakeFirestoreDoc | null => {
    if (path === 'config/prescriptionsAccess') return accessConfig;
    if (path === 'config/prescriptionsUploadQuota') return uploadQuota;
    return null;
  };

  const docHandle = (path: string) => ({
    path,
    get: async () => {
      const configDoc = docStoreForPath(path);
      if (configDoc) {
        return { exists: configDoc.data !== null, data: () => structuredClone(configDoc.data) };
      }
      if (path.startsWith('dailyRecords/')) {
        const dateKey = path.replace('dailyRecords/', '');
        return {
          exists: dailyRecords[dateKey] !== undefined,
          data: () => dailyRecords[dateKey] || null,
        };
      }
      return { exists: false, data: () => null };
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const configDoc = docStoreForPath(path);
      if (configDoc) {
        configDoc.data = options?.merge ? { ...(configDoc.data || {}), ...data } : data;
      } else if (path.startsWith('prescriptions/')) {
        if (harnessOptions.failPrescriptionWrite) {
          throw new Error('forced Firestore write failure');
        }
        const id = path.replace('prescriptions/', '');
        writtenPrescriptions[id] = data;
      }
    },
  });

  const buildPrescriptionsQuery = (
    filters: Array<{ field: string; op: string; value: unknown }>
  ) => ({
    where: (field: string, op: string, value: unknown) => {
      const nextFilters = [...filters, { field, op, value }];
      recordedPrescriptionQueries.push({ field, op, value });
      return buildPrescriptionsQuery(nextFilters);
    },
    get: async () => ({
      forEach: (callback: (doc: { data: () => Record<string, unknown> }) => void) => {
        Object.values(writtenPrescriptions)
          .filter(record =>
            filters.every(({ field, op, value }) => {
              const actual = record[field];
              if (typeof actual !== 'string' || typeof value !== 'string') return false;
              if (op === '>=') return actual >= value;
              if (op === '<') return actual < value;
              return actual === value;
            })
          )
          .forEach(record => {
            callback({ data: () => record });
          });
      },
    }),
  });

  const collection = (collectionName: string) => ({
    doc: (docId: string) => {
      if (collectionName === 'config') {
        return docHandle(`config/${docId}`);
      }
      if (collectionName === 'prescriptions') {
        return docHandle(`prescriptions/${docId}`);
      }
      if (collectionName === 'dailyRecords') {
        return docHandle(`dailyRecords/${docId}`);
      }
      return docHandle(`${collectionName}/${docId}`);
    },
    ...(collectionName === 'prescriptions'
      ? buildPrescriptionsQuery([])
      : {
          get: async () => ({
            forEach: () => undefined,
          }),
        }),
  });

  const hospitalDoc = {
    collection,
  };

  type TxDocRef = ReturnType<typeof docHandle>;
  const resolveTxStore = (ref: TxDocRef) => {
    const store = docStoreForPath(ref.path);
    if (!store) {
      throw new Error(`fake transaction does not support ${ref.path}`);
    }
    return store;
  };

  // Optimistic concurrency like Firestore: a transaction whose read document
  // changed before commit is retried from a fresh read.
  const runTransaction = async <T>(
    updateFunction: (tx: {
      get: (ref: TxDocRef) => ReturnType<TxDocRef['get']>;
      set: (ref: TxDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>
  ): Promise<T> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const readVersions = new Map<FakeFirestoreDoc, Record<string, unknown> | null>();
      const writes: Array<{
        store: FakeFirestoreDoc;
        data: Record<string, unknown>;
        merge: boolean;
      }> = [];
      const result = await updateFunction({
        get: async ref => {
          const store = resolveTxStore(ref);
          if (!readVersions.has(store)) {
            readVersions.set(store, store.data);
          }
          return ref.get();
        },
        set: (ref, data, options) => {
          const store = resolveTxStore(ref);
          writes.push({ store, data, merge: options?.merge === true });
        },
      });
      const conflict = Array.from(readVersions.entries()).some(
        ([store, version]) => store.data !== version
      );
      if (conflict) continue;
      for (const write of writes) {
        write.store.data = write.merge
          ? { ...(write.store.data || {}), ...write.data }
          : write.data;
      }
      return result;
    }
    throw new Error('fake transaction contention exceeded');
  };

  const admin = {
    firestore: () => ({
      runTransaction,
      collection: (name: string) => {
        if (name === 'hospitals') {
          return {
            doc: () => hospitalDoc,
          };
        }
        return collection(name);
      },
    }),
    storage: () => ({
      bucket: () => ({
        file: (path: string) => ({
          save: async (buffer: Buffer) => {
            storedBlobs[path] = buffer;
          },
          getMetadata: async () => [
            {
              bucket: 'hhr-test.appspot.com',
              metadata: {
                firebaseStorageDownloadTokens: `token-${path.replace(/[^a-z0-9]/gi, '-')}`,
              },
            },
          ],
          delete: async () => {
            delete storedBlobs[path];
          },
        }),
      }),
    }),
  };

  return {
    admin,
    accessConfig,
    uploadQuota,
    writtenPrescriptions,
    recordedPrescriptionQueries,
    storedBlobs,
  };
};

export const seedPin = async (accessConfig: FakeFirestoreDoc, pin: string) => {
  const salt = generatePinSalt();
  accessConfig.data = {
    pinHash: await hashPin(pin, salt),
    pinSalt: salt,
    pinHashAlgorithm: 'scrypt',
    pinUpdatedAt: '2026-05-01T00:00:00.000Z',
    pinUpdatedBy: 'admin@h.cl',
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
