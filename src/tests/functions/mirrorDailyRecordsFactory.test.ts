import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreDocument = vi.hoisted(() => vi.fn());

vi.mock('firebase-functions/v1', () => ({
  firestore: {
    document: firestoreDocument,
  },
}));

const require = createRequire(import.meta.url);
const {
  createMirrorDailyRecords,
} = require('../../../functions/lib/mirror/mirrorDailyRecordsFactory.js');

const RECORD_DATE = '2026-05-01';

describe('functions mirrorDailyRecordsFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreDocument.mockReturnValue({
      onWrite: (handler: (change: unknown, context: unknown) => unknown) => handler,
    });
  });

  it('overwrites the beta daily record from the official source payload', async () => {
    const betaSet = vi.fn().mockResolvedValue(undefined);
    const betaGet = vi.fn().mockResolvedValue({ exists: false });
    const dbBeta = {
      doc: vi.fn(() => ({
        get: betaGet,
        set: betaSet,
      })),
    };
    const serverTimestamp = {};
    const admin = {
      firestore: {
        FieldValue: {
          serverTimestamp: () => serverTimestamp,
        },
      },
    };
    const handler = createMirrorDailyRecords({ dbBeta, admin });

    await handler.run(
      {
        after: {
          exists: true,
          data: () => ({
            date: RECORD_DATE,
            beds: { H1: { patientName: 'Paciente principal' } },
          }),
        },
      },
      { params: { docId: RECORD_DATE } }
    );

    expect(dbBeta.doc).toHaveBeenCalledWith(
      expect.stringMatching(/^hospitals\/hanga_roa\/dailyRecords\//)
    );
    expect(betaSet).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: { H1: { patientName: 'Paciente principal' } },
        _syncedAt: serverTimestamp,
      })
    );
    expect(betaSet.mock.calls[0]).toHaveLength(1);
  });
});
