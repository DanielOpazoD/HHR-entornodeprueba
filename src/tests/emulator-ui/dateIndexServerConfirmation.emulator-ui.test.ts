import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  getAvailableDates,
  getForDateWithMeta,
  getPreviousDayWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { copyPatientToDateDetailed } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { fetchExistingDaysInMonth } from '@/services/records/recordQueryService';
import { auditAdmissionDateBackfill } from '@/services/admin/admissionDateBackfillService';
import { executeSendMedicalHandoff } from '@/application/handoff/sendMedicalHandoffUseCase';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { sendWhatsAppMessage } from '@/services/integrations/whatsapp/whatsappService';

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: {
    currentUser: {
      uid: 'synthetic-date-index-reader',
      email: 'hospitalizados@hospitalhangaroa.cl',
    },
  },
  storage: {},
  functions: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
  firebaseReady: Promise.resolve(),
  mountConfigWarning: vi.fn(),
}));
vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  formatHandoffMessage: vi.fn((_template: string, data: { signedBy: string }) => data.signedBy),
  sendWhatsAppMessage: vi.fn(async () => ({ success: true })),
}));

const host = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = host ? describe : describe.skip;
const PREVIOUS = '2026-03-10';
const TODAY = '2026-03-11';
const path = (date: string) => `hospitals/hanga_roa/dailyRecords/${date}`;
const withPatient = (date: string, doctor: string): DailyRecord => {
  const day = DataFactory.createMockDailyRecord(date, { medicalHandoffDoctor: doctor });
  day.beds.R1 = { ...day.beds.R1, patientName: 'Paciente Sintético', rut: '11.111.111-1' };
  return day;
};
const send = (doctor = '') =>
  executeSendMedicalHandoff({
    record: DataFactory.createMockDailyRecord(TODAY, { medicalHandoffDoctor: doctor }),
    templateContent: 'Plantilla sintética',
    targetGroupId: 'synthetic-group',
    patchRecord: vi.fn(async () => undefined),
    getPreviousDay: defaultDailyRecordReadPort.getPreviousDay,
  });

describeEmulator('census date index and previous day need server confirmation', () => {
  let environment: RulesTestEnvironment;
  let client = 0;
  let offline: { enableNetwork: () => Promise<void> } | null = null;

  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host ?? '');
    if (!endpoint) throw new Error('Use the canonical loopback Firestore emulator launcher.');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-date-index-confirmation',
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  }, 90_000);

  beforeEach(async () => {
    await environment.clearFirestore();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    vi.mocked(sendWhatsAppMessage).mockClear();
    setFirestoreEnabled(true);
  });

  afterEach(async () => {
    if (offline) {
      await offline.enableNetwork();
      offline = null;
      // Let the reconnected client settle before the next test clears the emulator.
      await new Promise(done => setTimeout(done, 10_000));
    }
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  }, 30_000);

  afterAll(async () => {
    await environment?.cleanup();
  });

  const seedServer = (...days: DailyRecord[]) =>
    environment.withSecurityRulesDisabled(async context => {
      for (const day of days)
        await context
          .firestore()
          .doc(path(day.date))
          .set(JSON.parse(JSON.stringify(day)));
    });
  /** A new client has an empty SDK cache, like a computer that has not read these days yet. */
  const openClient = async ({ network }: { network: boolean }) => {
    client += 1;
    const db = environment
      .authenticatedContext(`synthetic-date-index-reader-${client}`, {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    activeDb = db;
    if (!network) {
      await db.disableNetwork();
      offline = db;
    }
  };

  it('with network, lists the server days and signs with the previous day doctor', async () => {
    await seedServer(withPatient(PREVIOUS, 'Dra. Servidor'));
    await openClient({ network: true });

    await expect(getAvailableDates()).resolves.toEqual([PREVIOUS]);
    expect((await getPreviousDayWithMeta(TODAY)).record?.medicalHandoffDoctor).toBe(
      'Dra. Servidor'
    );
    const audit = await auditAdmissionDateBackfill();
    expect(audit.outcome).not.toBe('blocked');
    expect(audit.scannedDays).toBe(1);
    expect(await send()).toMatchObject({
      status: 'success',
      data: { doctorName: 'Dra. Servidor' },
    });
  });

  it('with network and no earlier day anywhere, still audits clean and signs "Sin especificar"', async () => {
    await openClient({ network: true });

    await expect(getAvailableDates()).resolves.toEqual([]);
    expect(await auditAdmissionDateBackfill()).toMatchObject({ outcome: 'clean', scannedDays: 0 });
    expect(await send()).toMatchObject({
      status: 'success',
      data: { doctorName: 'Sin especificar' },
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('synthetic-group', 'Sin especificar');
  });

  it('without network, an empty cache is neither a complete history nor a missing previous day', async () => {
    await seedServer(withPatient(PREVIOUS, 'Dra. Servidor'));
    await openClient({ network: false });

    const audit = await auditAdmissionDateBackfill();
    const sent = await send();
    expect({ outcome: audit.outcome, sent: sent.status }).toEqual({
      outcome: 'blocked',
      sent: 'failed',
    });
    expect(audit.userSafeMessage).toMatch(/lista de días/);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    await expect(getAvailableDates()).rejects.toMatchObject({
      status: 'partial',
      failed: 'remote',
    });
    await expect(getPreviousDayWithMeta(TODAY)).rejects.toBeDefined();
  });

  it('without network, keeps the work that does not need the server list', async () => {
    await seedServer(withPatient(PREVIOUS, 'Dra. Servidor'));
    await hospitalDB.dailyRecords.bulkPut([
      withPatient(PREVIOUS, 'Dra. Equipo'),
      DataFactory.createMockDailyRecord(TODAY),
    ]);
    await openClient({ network: false });

    expect(await send('Dr. Hoy')).toMatchObject({
      status: 'success',
      data: { doctorName: 'Dr. Hoy' },
    });
    expect(await send()).toMatchObject({
      status: 'success',
      data: { doctorName: 'Dra. Equipo' },
    });
    expect((await getForDateWithMeta(PREVIOUS)).record?.medicalHandoffDoctor).toBe('Dra. Equipo');
    expect(await fetchExistingDaysInMonth(2026, 3)).toEqual([10]);
    await copyPatientToDateDetailed(PREVIOUS, 'R1', TODAY, 'R2');
    expect((await hospitalDB.dailyRecords.get(TODAY))?.beds.R2.patientName).toBe(
      'Paciente Sintético'
    );
    // None of the flows above needed the server list, which cannot be confirmed here.
    await expect(getAvailableDates()).rejects.toMatchObject({ failed: 'remote' });
  });
});
