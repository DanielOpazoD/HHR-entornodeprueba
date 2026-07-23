import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { buildHarness, validJpegBase64 } from './documentScannerFunctions.testSupport';

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
  createConfirmScannedDocumentUploadedHandler,
  createSubmitScannedDocumentHandler,
} = require('../../../functions/lib/documentScannerFunctions.js');

describe('document scanner confirmation recovery', () => {
  it('keeps an idempotent purge pointer when confirmed Storage deletion fails', async () => {
    const { firestore, storage, records, blobs, controls } = buildHarness();
    const submit = createSubmitScannedDocumentHandler({
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
      submissionKey: 'scanner-confirmed-recovery',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    };
    const submitted = await submit(payload);
    const storagePath = records[submitted.id].storagePath as string;
    controls.failBlobDelete = true;
    const handler = createConfirmScannedDocumentUploadedHandler({
      firestore,
      storage,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const context = { auth: { uid: 'admin-1', token: { email: 'admin@hhr.cl' } } };

    await expect(handler({ id: submitted.id, confirmedInEloisa: true }, context)).rejects.toThrow(
      'forced Storage delete failure'
    );
    expect(records[submitted.id]).toMatchObject({ state: 'purge_pending', storagePath });
    expect(records[submitted.id]).not.toHaveProperty('patientName');
    expect(records.__quota__.activeCount).toBe(1);
    await expect(submit(payload)).resolves.toMatchObject({
      id: submitted.id,
      deduplicated: true,
      completed: true,
    });
    expect(records[submitted.id]).toMatchObject({ state: 'purge_pending', storagePath });

    controls.failBlobDelete = false;
    await expect(
      handler({ id: submitted.id, confirmedInEloisa: true }, context)
    ).resolves.toMatchObject({ ok: true, purged: true });
    expect(records[submitted.id]).toMatchObject({ state: 'completed' });
    expect(records.__quota__.activeCount).toBe(0);
    expect(blobs[storagePath]).toBeUndefined();
  });
});
