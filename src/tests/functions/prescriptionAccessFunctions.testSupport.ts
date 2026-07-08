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
  const writtenPrescriptions: Record<string, Record<string, unknown>> = {
    ...(harnessOptions.prescriptionRecords || {}),
  };
  const storedBlobs: Record<string, Buffer> = {};
  const dailyRecords = harnessOptions.dailyRecords || {};

  const docHandle = (path: string) => ({
    get: async () =>
      path.endsWith('config/prescriptionsAccess')
        ? { exists: accessConfig.data !== null, data: () => accessConfig.data }
        : path.startsWith('dailyRecords/')
          ? {
              exists: dailyRecords[path.replace('dailyRecords/', '')] !== undefined,
              data: () => dailyRecords[path.replace('dailyRecords/', '')] || null,
            }
          : { exists: false, data: () => null },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (path.endsWith('config/prescriptionsAccess')) {
        accessConfig.data = options?.merge ? { ...(accessConfig.data || {}), ...data } : data;
      } else if (path.startsWith('prescriptions/')) {
        if (harnessOptions.failPrescriptionWrite) {
          throw new Error('forced Firestore write failure');
        }
        const id = path.replace('prescriptions/', '');
        writtenPrescriptions[id] = data;
      }
    },
  });

  const collection = (collectionName: string) => ({
    doc: (docId: string) => {
      if (collectionName === 'config' && docId === 'prescriptionsAccess') {
        return docHandle('config/prescriptionsAccess');
      }
      if (collectionName === 'prescriptions') {
        return docHandle(`prescriptions/${docId}`);
      }
      if (collectionName === 'dailyRecords') {
        return docHandle(`dailyRecords/${docId}`);
      }
      return docHandle(`${collectionName}/${docId}`);
    },
    get: async () => ({
      forEach: (callback: (doc: { data: () => Record<string, unknown> }) => void) => {
        if (collectionName !== 'prescriptions') return;
        Object.values(writtenPrescriptions).forEach(record => {
          callback({ data: () => record });
        });
      },
    }),
  });

  const hospitalDoc = {
    collection,
  };

  const admin = {
    firestore: () => ({
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

  return { admin, accessConfig, writtenPrescriptions, storedBlobs };
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
