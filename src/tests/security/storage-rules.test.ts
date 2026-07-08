import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const runStorageRulesTests =
  process.env.RUN_STORAGE_RULES_TESTS === '1' ||
  process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined;

const describeStorageRules = runStorageRulesTests ? describe : describe.skip;

const parseStorageEmulatorHost = (): { host: string; port: number } => {
  const configured = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
  const [host, portValue] = configured.split(':');
  const port = Number.parseInt(portValue, 10);
  if (!host || !Number.isFinite(port)) {
    throw new Error(`Invalid FIREBASE_STORAGE_EMULATOR_HOST: ${configured}`);
  }
  return { host, port };
};

const storagePath = 'clinical-attachments/hhr/13545665-9/135456659__2026-04-15/att_1/informe.pdf';

const uploadClinicalAttachment = (
  storage: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['storage']>,
  filePath: string,
  bytes: Uint8Array,
  contentType: string
) => uploadBytes(ref(storage, filePath), new Blob([bytes], { type: contentType }), { contentType });

describeStorageRules('Storage Security Rules - clinical attachments', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../storage.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = parseStorageEmulatorHost();

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-storage-rules-test',
      storage: {
        rules,
        host: emulatorConfig.host,
        port: emulatorConfig.port,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it('allows clinical writers to upload allowed attachment files and clinical readers to read them', async () => {
    const nurseStorage = testEnv
      .authenticatedContext('user_nurse', { role: 'nurse_hospital' })
      .storage();
    const doctorStorage = testEnv
      .authenticatedContext('user_doctor', { role: 'doctor_urgency' })
      .storage();

    await assertSucceeds(
      uploadClinicalAttachment(nurseStorage, storagePath, new Uint8Array(1024), 'application/pdf')
    );
    await assertSucceeds(getBytes(ref(doctorStorage, storagePath)));
  });

  it('allows doctors to upload clinical attachments without opening other storage surfaces', async () => {
    const doctorStorage = testEnv
      .authenticatedContext('user_doctor', { role: 'doctor_urgency' })
      .storage();

    await assertSucceeds(
      uploadClinicalAttachment(doctorStorage, storagePath, new Uint8Array(1024), 'application/pdf')
    );
    await assertFails(
      uploadClinicalAttachment(
        doctorStorage,
        'censo-diario/hhr/export.pdf',
        new Uint8Array(1024),
        'application/pdf'
      )
    );
  });

  it('allows specialist doctors to upload and read clinical attachments only in attachment storage', async () => {
    const specialistStorage = testEnv
      .authenticatedContext('user_specialist', { role: 'doctor_specialist' })
      .storage();

    await assertSucceeds(
      uploadClinicalAttachment(
        specialistStorage,
        storagePath.replace('att_1/informe.pdf', 'att_specialist/informe.pdf'),
        new Uint8Array(1024),
        'application/pdf'
      )
    );
    await assertSucceeds(
      getBytes(
        ref(
          specialistStorage,
          storagePath.replace('att_1/informe.pdf', 'att_specialist/informe.pdf')
        )
      )
    );
    await assertFails(
      uploadClinicalAttachment(
        specialistStorage,
        'censo-diario/hhr/export.pdf',
        new Uint8Array(1024),
        'application/pdf'
      )
    );
  });

  it('blocks read-only roles from uploading clinical attachments', async () => {
    const viewerStorage = testEnv.authenticatedContext('user_viewer', { role: 'viewer' }).storage();

    await assertFails(
      uploadClinicalAttachment(viewerStorage, storagePath, new Uint8Array(1024), 'application/pdf')
    );
  });

  it('blocks unsupported content types and oversized clinical attachments', async () => {
    const nurseStorage = testEnv
      .authenticatedContext('user_nurse', { role: 'nurse_hospital' })
      .storage();

    await assertFails(
      uploadClinicalAttachment(
        nurseStorage,
        storagePath.replace('informe.pdf', 'archivo.zip'),
        new Uint8Array(1024),
        'application/zip'
      )
    );
    await assertFails(
      uploadClinicalAttachment(
        nurseStorage,
        storagePath.replace('informe.pdf', 'grande.pdf'),
        new Uint8Array(15 * 1024 * 1024),
        'application/pdf'
      )
    );
  });

  it('blocks unauthenticated reads and writes', async () => {
    const unauthStorage = testEnv.unauthenticatedContext().storage();

    await assertFails(getBytes(ref(unauthStorage, storagePath)));
    await assertFails(
      uploadClinicalAttachment(unauthStorage, storagePath, new Uint8Array(1024), 'application/pdf')
    );
  });
});
