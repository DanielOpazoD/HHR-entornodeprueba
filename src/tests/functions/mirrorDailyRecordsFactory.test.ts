import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// The mirror skips records older than 48h. Pin the clock to a moment one hour
// after the record date so the test does not become time-dependent on the
// real-world wall clock (the previous hard-coded date silently broke once
// 48 real hours had elapsed since 2026-05-01).
const RECORD_DATE = '2026-05-01';
const FROZEN_NOW = new Date(`${RECORD_DATE}T01:00:00.000Z`);

describe('functions mirrorDailyRecordsFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    firestoreDocument.mockReturnValue({
      onWrite: (handler: (change: unknown, context: unknown) => unknown) => handler,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
