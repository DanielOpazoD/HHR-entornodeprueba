// @vitest-environment node
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrescriptionUploadViewerDayOptions } from '@/features/prescriptions/components/prescriptionUploadReadonlyViewerSupport';
import { listPatientOptionsWithPrescriptionPin } from '@/shared/document-intake/qrDocumentAccessService';
import { submitScannedDocument } from '@/features/document-scanner/services/documentScannerQueueService';
import {
  buildAdminHarness,
  createListUploadPatientOptionsHandler,
  createListUploadReadonlyRecordsHandler,
  resolveUploadPatientOptionForExactDate,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';
import { buildHarness, validJpegBase64 } from './documentScannerFunctions.testSupport';

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => (payload: unknown) =>
    transport.call(name, payload),
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));
const require = createRequire(import.meta.url);
const {
  createSubmitScannedDocumentHandler,
} = require('../../../functions/lib/documentScannerFunctions.js');
const {
  validatePinAgainstConfig,
} = require('../../../functions/lib/prescriptionAccessFunctions.js');

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-25T03:30:00.000Z'));
});

describe('real mobile dates against server handlers at 22:30 hospital time', () => {
  it.each(['today', 'yesterday'])(
    'opens the viewer %s tab with its hospital records',
    async key => {
      const options = buildPrescriptionUploadViewerDayOptions();
      const option = options.find(day => day.key === key);
      const expectedDate = key === 'today' ? '2026-10-24' : '2026-10-23';
      const { admin, accessConfig } = buildAdminHarness({
        prescriptionRecords: {
          today: { id: 'today', createdAt: '2026-10-25T03:00:00Z' },
          yesterday: { id: 'yesterday', createdAt: '2026-10-24T03:00:00Z' },
        },
      });
      await seedPin(accessConfig, '7351');
      const list = createListUploadReadonlyRecordsHandler({
        firestore: admin.firestore(),
        storage: admin.storage(),
        resolveRoleForEmail: vi.fn(),
      });
      const result = await list({ pin: '7351', date: option?.isoDate }, undefined);
      expect(option?.isoDate).toBe(expectedDate);
      expect(result.date).toBe(expectedDate);
      expect(result.records.map((record: { id: string }) => record.id)).toEqual([key]);
    }
  );

  it('uploads the scanner document using the real QR client date and exact-date resolver', async () => {
    const dailyRecord = {
      beds: { H1C2: { patientName: 'Paciente Sintético', rut: '11.111.111-1' } },
    };
    const { admin, accessConfig } = buildAdminHarness({
      dailyRecords: { '2026-10-24': dailyRecord, '2026-10-25': dailyRecord },
    });
    await seedPin(accessConfig, '7351');
    const queue = buildHarness();
    const hospital = admin.firestore().collection('hospitals').doc('synthetic-hospital');
    if (!('collection' in hospital)) throw new Error('Synthetic hospital fixture is missing.');
    const firestore = {
      collection: () => ({
        doc: () => ({
          collection: (name: string) =>
            ['config', 'dailyRecords'].includes(name)
              ? hospital.collection(name)
              : queue.firestore.collection().doc().collection(),
        }),
      }),
      runTransaction: queue.firestore.runTransaction,
    };
    const list = createListUploadPatientOptionsHandler({ firestore });
    const upload = createSubmitScannedDocumentHandler({
      firestore,
      storage: queue.storage,
      validatePin: validatePinAgainstConfig,
      resolvePatientOption: resolveUploadPatientOptionForExactDate,
    });
    transport.call.mockImplementation(async (name: string, payload: unknown) => ({
      data: await (name === 'listPrescriptionUploadPatientOptions'
        ? list(payload)
        : upload(payload)),
    }));
    const options = await listPatientOptionsWithPrescriptionPin('7351');
    const patient = options.patientOptions[0];
    const result = await submitScannedDocument({
      pin: '7351',
      submissionKey: 'hospital-clock-scan-0001',
      requestDate: options.date,
      sourceDate: options.sourceDate ?? options.date,
      patientOptionKey: patient.key,
      expectedPatientRut: patient.patientRut,
      pageCount: 1,
      pageImagesBase64: [validJpegBase64],
    });
    expect(options.date).toBe('2026-10-24');
    expect(queue.records[result.id]).toMatchObject({
      requestDate: '2026-10-24',
      sourceDate: '2026-10-24',
      state: 'pending_eloisa',
      patientName: 'Paciente Sintético',
      patientRut: '11.111.111-1',
    });
    expect(Object.values(queue.blobs)[0].subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
