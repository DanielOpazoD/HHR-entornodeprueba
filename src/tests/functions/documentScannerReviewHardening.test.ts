import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildHarness,
  maximumDimensionJpegBase64,
  oversizedJpegBase64,
} from './documentScannerFunctions.testSupport';

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
  createListScannedDocumentsHandler,
  decodeJpegPages,
  resolvePdfDownloadUrl,
} = require('../../../functions/lib/documentScannerFunctions.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('document scanner review hardening', () => {
  it('keeps the queue available when a production signed URL cannot be created', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = {
      bucket: () => ({
        file: () => ({ getSignedUrl: vi.fn().mockRejectedValue(new Error('signing unavailable')) }),
      }),
    };

    await expect(
      resolvePdfDownloadUrl(storage, 'scanned-documents/hhr/test.pdf')
    ).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith(
      '[document-scanner] failed to create temporary download URL'
    );
  });

  it('reports the aggregate pixel budget separately from the per-page dimension limit', () => {
    expect(() => decodeJpegPages(Array(10).fill(maximumDimensionJpegBase64), 10)).toThrow(
      'límite total de resolución'
    );
    expect(() => decodeJpegPages([oversizedJpegBase64], 1)).toThrow('como máximo 2200 px por lado');
  });

  it('lists only the public queue contract for an authenticated clinician', async () => {
    const { firestore, storage, records } = buildHarness();
    records.scan_1 = {
      id: 'scan_1',
      state: 'pending_eloisa',
      storagePath: 'scanned-documents/hhr/scan_1/document.pdf',
      submissionKeyHash: 'private-hash',
      quotaSlotHeld: true,
      uploader: { uid: 'private-uploader' },
      createdAt: '2026-07-22T12:00:00.000Z',
    };
    const handler = createListScannedDocumentsHandler({
      firestore,
      storage,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });

    const result = await handler({}, { auth: { uid: 'nurse-1', token: { email: 'ENF@HHR.CL' } } });

    expect(result).toMatchObject({
      documents: [{ id: 'scan_1', downloadUrl: expect.stringContaining('storage.test') }],
    });
    expect(result.documents[0]).not.toHaveProperty('storagePath');
    expect(result.documents[0]).not.toHaveProperty('submissionKeyHash');
    expect(result.documents[0]).not.toHaveProperty('quotaSlotHeld');
    expect(result.documents[0]).not.toHaveProperty('uploader');
    await expect(handler({}, undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
