import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { getPreviousDay } from '@/utils/clinicalDayScheduleUtils';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST;
(enabled ? describe : describe.skip)('trusted clinical carryover persistence', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  beforeEach(() => {
    // Keep the copy-intent date stable while real Firestore transport timers continue.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T16:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
      throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-hhr-clinical-carryover' }, 'clinical-carryover');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it('persists only trusted previous evidence, preserves its source and rejects a later forged overwrite', async () => {
    const today = calendarStampInClinicalTimeZone(new Date()).iso;
    const yesterday = getPreviousDay(today);
    const measured = getPreviousDay(yesterday);
    await db.recursiveDelete(db.doc(hospital));
    await db
      .doc(`${hospital}/settings/rayenImportPolicy`)
      .set({ schemaVersion: 2, mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' });
    const patient = {
      ...makeRecord().beds.R1,
      admissionDate: measured,
      vitalSigns: { recordedDate: measured, recordedAt: `${measured} 10:30`, heartRate: 72 },
      devices: ['CUP'],
      deviceDetails: { CUP: { installationDate: measured } },
    };
    const previousRef = db.doc(`${hospital}/dailyRecords/${yesterday}`);
    await previousRef.set({ ...makeRecord(), date: yesterday, beds: { R1: patient } });
    const before = (await previousRef.get()).data();
    const beforeVersion = (await previousRef.get()).updateTime;
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const request = {
      ...makeRecord(),
      date: today,
      beds: {
        R1: {
          ...patient,
          vitalSigns: { heartRate: 999 },
          devices: ['CVC'],
          deviceDetails: { CVC: { installationDate: today } },
          clinicalCarryover: {
            // The exact prior date is the copy-intent gate, not trusted evidence.
            sourceDate: yesterday,
            clinicalEpisodeId: 'forged-episode',
            vitalsPending: false,
            devicesPending: false,
          },
        },
      },
    };
    await api.saveDailyRecordWithClinicalAuthority.run(
      { date: today, mode: 'shadow', record: request },
      makeContext()
    );
    const destination = db.doc(`${hospital}/dailyRecords/${today}`);
    const saved = (await destination.get()).data()!;
    expect(saved.beds.R1.vitalSigns).toEqual(patient.vitalSigns);
    expect(saved.beds.R1.devices).toEqual(['CUP']);
    expect(saved.beds.R1.deviceDetails.CUP.installationDate).toBe(measured);
    expect(saved.beds.R1.clinicalCarryover).toMatchObject({
      sourceDate: yesterday,
      clinicalEpisodeId: makeRecord().beds.R1.clinicalEpisodeId,
      vitalsPending: true,
      devicesPending: true,
    });
    await api.saveDailyRecordWithClinicalAuthority.run(
      { date: today, mode: 'shadow', record: request },
      makeContext()
    );
    const repeated = (await destination.get()).data()!.beds.R1;
    for (const field of [
      'vitalSigns',
      'devices',
      'deviceDetails',
      'deviceInstanceHistory',
      'clinicalCarryover',
    ]) {
      expect(repeated[field]).toEqual(saved.beds.R1[field]);
    }
    const after = await previousRef.get();
    expect(after.data()).toEqual(before);
    expect(after.updateTime?.isEqual(beforeVersion!)).toBe(true);
    expect((await previousRef.collection('history').get()).empty).toBe(true);
  });
});
