import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
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
  assertAuthenticatedClinicalRequest,
  loadMinsalRecords,
  parseMinsalRangeRequest,
} = require('../../../functions/lib/minsal/minsalRequestPolicy.js');

describe('functions minsalRequestPolicy', () => {
  it('validates request payload and supported hospital ids', () => {
    expect(
      parseMinsalRangeRequest({
        hospitalId: 'hanga_roa',
        startDate: '2026-03-01',
        endDate: '2026-03-02',
      })
    ).toEqual({
      hospitalId: 'hanga_roa',
      startDate: '2026-03-01',
      endDate: '2026-03-02',
    });

    expect(() => parseMinsalRangeRequest({ hospitalId: 'otro' })).toThrow();
  });

  it('requires authenticated clinical access and loads filtered records', async () => {
    await expect(
      assertAuthenticatedClinicalRequest({ auth: { token: {} } }, async () => true)
    ).resolves.toBeUndefined();

    const get = vi.fn().mockResolvedValue({
      forEach: (callback: (doc: { data: () => { date: string } }) => void) => {
        callback({ data: () => ({ date: '2026-03-01' }) });
      },
    });
    const whereEnd = vi.fn(() => ({ get }));
    const whereStart = vi.fn(() => ({ where: whereEnd }));
    const firestore = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            where: whereStart,
          }),
        }),
      }),
    };

    await expect(
      loadMinsalRecords(firestore, 'hanga_roa', '2026-03-01', '2026-03-02')
    ).resolves.toEqual([{ date: '2026-03-01' }]);
  });
});
