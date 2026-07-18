import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

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
const {
  createHandoffSignatureFunctions,
} = require('../../../functions/lib/handoffSignatureFunctions.js');

const createFirestoreMock = (record: Record<string, unknown>) => {
  const setRecord = vi.fn().mockResolvedValue(undefined);
  const setAudit = vi.fn().mockResolvedValue(undefined);

  return {
    firestore: {
      collection: () => ({
        doc: (_docId: string) => ({
          collection: () => ({
            doc: () => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => record,
              }),
              set: setRecord,
            }),
          }),
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => record,
            }),
            set: setRecord,
          }),
        }),
      }),
    },
    setRecord,
    setAudit,
  };
};

describe('functions handoffSignatureFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects payload fetch when the link token does not match', async () => {
    const { firestore } = createFirestoreMock({
      medicalSignatureLinkTokenByScope: {
        all: 'valid-token',
      },
    });

    const functionsApi = createHandoffSignatureFunctions({ firestore });

    await expect(
      functionsApi.getMedicalHandoffSignaturePayload.run({
        date: '2026-03-03',
        scope: 'all',
        token: 'invalid-token',
      })
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('stores scoped medical signature and writes an audit entry', async () => {
    const setRecord = vi.fn().mockResolvedValue(undefined);
    const setAudit = vi.fn().mockResolvedValue(undefined);
    const firestore = {
      collection: () => ({
        doc: () => ({
          collection: (name: string) => ({
            doc: () => {
              if (name === 'dailyRecords') {
                return {
                  get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({
                      medicalSignatureLinkTokenByScope: { upc: 'scope-token' },
                    }),
                  }),
                  set: setRecord,
                };
              }
              return {
                set: setAudit,
              };
            },
          }),
        }),
      }),
    };

    const functionsApi = createHandoffSignatureFunctions({ firestore });
    const result = await functionsApi.submitMedicalHandoffSignature.run({
      date: '2026-03-03',
      scope: 'upc',
      token: 'scope-token',
      doctorName: 'Dr. Test',
      userAgent: 'Vitest',
    });

    expect(setRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalSignatureByScope: expect.objectContaining({
          upc: expect.objectContaining({
            doctorName: 'Dr. Test',
          }),
        }),
      }),
      { merge: true }
    );
    expect(setAudit).toHaveBeenCalled();
    expect(result).toMatchObject({
      scope: 'upc',
      alreadySigned: false,
      signature: expect.objectContaining({
        doctorName: 'Dr. Test',
      }),
    });
  });
});
