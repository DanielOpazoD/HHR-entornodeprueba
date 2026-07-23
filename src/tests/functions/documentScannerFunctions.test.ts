import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHarness,
  differentJpegBase64,
  oversizedJpegBase64,
  validJpegBase64,
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
const scannerFunctions = require('../../../functions/lib/documentScannerFunctions.js');
const {
  createSubmitScannedDocumentHandler,
  createListScannedDocumentsHandler,
  createConfirmScannedDocumentUploadedHandler,
  resolvePdfDownloadUrl,
} = scannerFunctions;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('document scanner temporary queue', () => {
  it('creates a tokenized local Storage URL when running in the emulator', async () => {
    const { storage } = buildHarness();
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');

    const url = await resolvePdfDownloadUrl(storage, 'scanned-documents/hanga_roa/test.pdf');

    expect(url).toMatch(
      /^http:\/\/127\.0\.0\.1:9199\/v0\/b\/hhr-local-scanner\.appspot\.com\/o\/scanned-documents%2Fhanga_roa%2Ftest\.pdf\?alt=media&token=[0-9a-f-]+$/
    );
  });

  it('reuses the supplied prescription PIN validator and stores a PDF temporarily', async () => {
    const { firestore, storage, records, blobs } = buildHarness();
    const validatePin = vi.fn().mockResolvedValue(undefined);
    const resolvePatientOption = vi.fn().mockResolvedValue({
      sourceDate: '2026-07-22',
      patient: {
        key: 'H1C2',
        bedId: 'H1C2',
        patientName: 'Paciente Prueba',
        patientRut: '11.111.111-1',
      },
    });
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin,
      resolvePatientOption,
    });

    const result = await handler({
      pin: '1313',
      submissionKey: 'scanner-submission-0001',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 2,
      pageImagesBase64: [validJpegBase64, validJpegBase64],
    });

    expect(validatePin).toHaveBeenCalledWith(firestore, '1313');
    expect(resolvePatientOption).toHaveBeenCalledWith(
      firestore,
      '2026-07-22',
      '2026-07-22',
      'H1C2',
      '11.111.111-1'
    );
    expect(result.id).toMatch(/^scan_/);
    expect(records[result.id]).toMatchObject({
      bedId: 'H1C2',
      patientRut: '11.111.111-1',
      state: 'pending_eloisa',
      uploader: { source: 'qr_pin' },
      sourceDate: '2026-07-22',
    });
    expect(Object.keys(blobs)).toEqual([
      expect.stringMatching(new RegExp(`${result.id}/[a-f0-9]{32}\\.pdf$`)),
    ]);
    const storedPdf = Object.values(blobs)[0];
    expect(storedPdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(storedPdf.toString('latin1')).not.toMatch(/JavaScript|OpenAction|EmbeddedFiles/);
  });

  it('rejects content that is not a JPEG page', async () => {
    const { firestore, storage } = buildHarness();
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });

    await expect(
      handler({
        pin: '1313',
        submissionKey: 'scanner-submission-0002',
        sourceDate: '2026-07-22',
        patientOptionKey: 'H1C2',
        expectedPatientRut: '11.111.111-1',
        pageCount: 1,
        pageImagesBase64: [Buffer.from('not-a-jpeg').toString('base64')],
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects JPEG dimensions above the scanner output limit', async () => {
    const { firestore, storage } = buildHarness();
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });

    await expect(
      handler({
        pin: '1313',
        submissionKey: 'scanner-submission-oversized',
        sourceDate: '2026-07-22',
        patientOptionKey: 'H1C2',
        expectedPatientRut: '11.111.111-1',
        pageCount: 1,
        pageImagesBase64: [oversizedJpegBase64],
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects new uploads when the temporary queue quota is full', async () => {
    const { firestore, storage, records, blobs } = buildHarness();
    records.__quota__ = {
      activeCount: 100,
      windowStartedAt: '2026-07-22T12:00:00.000Z',
      windowSubmissionCount: 1,
    };
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });

    await expect(
      handler({
        pin: '1313',
        submissionKey: 'scanner-submission-quota',
        sourceDate: '2026-07-22',
        patientOptionKey: 'H1C2',
        expectedPatientRut: '11.111.111-1',
        pageCount: 1,
        pageImagesBase64: [validJpegBase64],
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(Object.keys(blobs)).toHaveLength(0);
  });

  it('returns the existing record before revalidating a mutable census', async () => {
    const { firestore, storage } = buildHarness();
    const resolvePatientOption = vi.fn().mockResolvedValue({
      sourceDate: '2026-07-22',
      patient: {
        key: 'H1C2',
        bedId: 'H1C2',
        patientName: 'Paciente Prueba',
        patientRut: '11.111.111-1',
      },
    });
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption,
    });
    const payload = {
      pin: '1313',
      submissionKey: 'scanner-submission-retry',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };

    const first = await handler(payload);
    resolvePatientOption.mockRejectedValueOnce(new Error('the bed now belongs to another patient'));
    const retried = await handler(payload);

    expect(retried).toEqual({ ...first, deduplicated: true, completed: false });
    expect(resolvePatientOption).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a submission key for a different PDF payload', async () => {
    const { firestore, storage, records } = buildHarness();
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });
    const payload = {
      pin: '1313',
      submissionKey: 'scanner-submission-mismatch',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };
    const first = await handler(payload);

    await expect(
      handler({
        ...payload,
        pageImagesBase64: [differentJpegBase64],
      })
    ).rejects.toMatchObject({ code: 'already-exists' });
    expect(records[first.id]).toMatchObject({ patientRut: '11.111.111-1', pageCount: 1 });
  });

  it('deduplicates a late mobile retry after the clinical copy was purged', async () => {
    const { firestore, storage, records, blobs } = buildHarness();
    const resolvePatientOption = vi.fn().mockResolvedValue({
      sourceDate: '2026-07-22',
      patient: {
        key: 'H1C2',
        bedId: 'H1C2',
        patientName: 'Paciente Prueba',
        patientRut: '11.111.111-1',
      },
    });
    const submit = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption,
    });
    const payload = {
      pin: '1313',
      submissionKey: 'scanner-submission-purged-retry',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };
    const first = await submit(payload);
    const confirm = createConfirmScannedDocumentUploadedHandler({
      firestore,
      storage,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    await confirm(
      { id: first.id, confirmedInEloisa: true },
      { auth: { uid: 'admin-1', token: { email: 'admin@hhr.cl' } } }
    );

    await expect(submit(payload)).resolves.toMatchObject({
      id: first.id,
      deduplicated: true,
      completed: true,
    });
    expect(Object.keys(blobs)).toHaveLength(0);
    expect(records[first.id]).not.toHaveProperty('patientRut');
    expect(resolvePatientOption).toHaveBeenCalledTimes(1);
  });

  it('deletes a lease-unique PDF when an expired in-flight upload loses its reservation', async () => {
    const { firestore, storage, records, blobs, controls } = buildHarness();
    controls.prepareBlockedSave();
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });
    const payload = {
      pin: '1313',
      submissionKey: 'scanner-submission-lease-race',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };

    const firstUpload = handler(payload);
    const firstUploadResult = expect(firstUpload).rejects.toMatchObject({ code: 'aborted' });
    await controls.blockedSaveStarted;
    vi.setSystemTime(new Date('2026-07-22T12:06:00.000Z'));

    const retry = await handler(payload);
    controls.releaseBlockedSave();
    await firstUploadResult;

    expect(records[retry.id]).toMatchObject({ state: 'pending_eloisa' });
    expect(Object.keys(blobs)).toEqual([records[retry.id].storagePath]);
  });

  it('returns a competing completed reservation created immediately after cleanup', async () => {
    const { firestore, storage, records, blobs, controls } = buildHarness();
    const handler = createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin: vi.fn().mockResolvedValue(undefined),
      resolvePatientOption: vi.fn().mockResolvedValue({
        sourceDate: '2026-07-22',
        patient: {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
        },
      }),
    });
    const payload = {
      pin: '1313',
      submissionKey: 'scanner-submission-cleanup-race',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };
    const first = await handler(payload);
    records[first.id] = { ...records[first.id], state: 'cleanup_pending' };
    const competingPath = `scanned-documents/hhr/${first.id}/competing.pdf`;
    controls.afterQueueDelete = (id, previous) => {
      blobs[competingPath] = Buffer.from('%PDF-1.4\ncompeting');
      records[id] = {
        ...previous,
        state: 'pending_eloisa',
        storagePath: competingPath,
        createdAt: '2026-07-22T12:00:01.000Z',
      };
    };

    await expect(handler(payload)).resolves.toMatchObject({
      id: first.id,
      deduplicated: true,
    });
    expect(records[first.id]).toMatchObject({
      state: 'pending_eloisa',
      storagePath: competingPath,
    });
    expect(Object.keys(blobs)).toEqual([competingPath]);
  });

  it('keeps a durable cleanup pointer when deleting an incomplete PDF fails', async () => {
    const { firestore, storage, records, blobs, controls } = buildHarness();
    const storagePath = 'scanned-documents/hhr/scan_stale/attempt.pdf';
    records.scan_stale = {
      id: 'scan_stale',
      state: 'cleanup_pending',
      storagePath,
      submissionKeyHash: 'hash-stale',
    };
    blobs[storagePath] = Buffer.from('temporary');
    controls.failBlobDelete = true;
    const handler = createListScannedDocumentsHandler({
      firestore,
      storage,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });

    await handler({}, { auth: { uid: 'admin-1', token: { email: 'admin@hhr.cl' } } });

    expect(records.scan_stale).toMatchObject({ state: 'cleanup_pending', storagePath });
    expect(blobs[storagePath]).toBeTruthy();
  });

  it('does not purge unless Eloisa confirmation is explicit, then deletes blob and metadata', async () => {
    const { firestore, storage, records, blobs } = buildHarness();
    const storagePath = 'scanned-documents/hhr/scan_1/document.pdf';
    records.scan_1 = {
      id: 'scan_1',
      state: 'pending_eloisa',
      storagePath,
      submissionKeyHash: 'hash-1',
      patientName: 'Paciente Prueba',
      patientRut: '11.111.111-1',
    };
    blobs[storagePath] = Buffer.from('temporary');
    const handler = createConfirmScannedDocumentUploadedHandler({
      firestore,
      storage,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const context = { auth: { uid: 'admin-1', token: { email: 'admin@hhr.cl' } } };

    await expect(
      handler({ id: 'scan_1', confirmedInEloisa: false }, context)
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(records.scan_1).toBeTruthy();
    expect(blobs[storagePath]).toBeTruthy();

    await expect(handler({ id: 'scan_1', confirmedInEloisa: true }, context)).resolves.toEqual({
      ok: true,
      purged: true,
    });
    expect(records.scan_1).toMatchObject({
      id: 'scan_1',
      state: 'completed',
      submissionKeyHash: 'hash-1',
      completedAt: expect.any(String),
      tombstoneExpiresAt: expect.any(String),
    });
    expect(records.scan_1).not.toHaveProperty('patientName');
    expect(records.scan_1).not.toHaveProperty('patientRut');
    expect(records.scan_1).not.toHaveProperty('storagePath');
    expect(blobs[storagePath]).toBeUndefined();
  });
});
