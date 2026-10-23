/* @flake-safe: Date usage aligns emulator write-window assertions with current execution time. */
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  doc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const runEmulatorTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeEmulator = runEmulatorTests ? describe : describe.skip;

let activeDb: unknown;

vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

// Counts transaction attempts and can land one write between a callback and its commit.
const interleave = vi.hoisted(() => ({
  attempts: 0,
  beforeFirstCommit: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('firebase/firestore', async original => {
  const actual = await original<typeof import('firebase/firestore')>();
  return {
    ...actual,
    runTransaction: <T>(db: Firestore, update: (tx: Transaction) => Promise<T>) =>
      actual.runTransaction(db, async transaction => {
        interleave.attempts += 1;
        const result = await update(transaction);
        const interleaved = interleave.beforeFirstCommit;
        interleave.beforeFirstCommit = undefined;
        await interleaved?.();
        return result;
      }),
  };
});

import {
  ConcurrencyError,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import {
  docToRecord,
  getRecordDocRef,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';
import { prepareFirestorePartialData } from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';
import { updateRecordPartiallyAtomically } from '@/services/storage/firestore/firestoreWriteSupport';
import { projectFirestoreUpdate } from '@/services/storage/firestore/firestoreUpdateProjection';
import type { DirectFirestoreWriteReceipt } from '@/services/storage/firestore/firestoreDirectWriteReceipt';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';

// Synthetic census data only. The writer keeps a census listener attached, as the app does, so a
// server readback on that client could be answered from the listener's pre-commit view.
const DATE = getTodayISO();
const RECORD_PATH = `hospitals/hanga_roa/dailyRecords/${DATE}`;
const BASE_VERSION = new Date(Date.now() - 60_000).toISOString();

const buildRecord = (): Record<string, unknown> => ({
  date: DATE,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: BASE_VERSION,
  nurses: [],
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
  dateTimestamp: Date.parse(`${DATE}T00:00:00.000Z`),
});

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Sintético',
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnóstico sintético',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-10',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

type TestFirestore = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;

describeEmulator('Firestore emulator atomic partial committed record', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;
  let otherNurseDb: TestFirestore;
  let stopListener: (() => void) | undefined;

  const seed = (data: Record<string, unknown>) =>
    testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore() as unknown as Firestore, RECORD_PATH), data);
    });

  // Independent read: a separate client without listeners, rules disabled.
  const readServerData = async (): Promise<DocumentData> => {
    let data: DocumentData | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      const snap = await getDocFromServer(
        doc(context.firestore() as unknown as Firestore, RECORD_PATH)
      );
      data = snap.data();
    });
    if (!data) throw new Error('missing synthetic record');
    return data;
  };

  const attachCensusListener = async () => {
    await new Promise<void>((resolve, reject) => {
      stopListener = onSnapshot(
        getRecordDocRef(DATE),
        { includeMetadataChanges: true },
        snap => {
          if (snap.exists() && !snap.metadata.fromCache) resolve();
        },
        reject
      );
    });
  };

  const expectReceiptMatchesServer = async (receipt: unknown): Promise<DailyRecord> => {
    const record = (receipt as DirectFirestoreWriteReceipt | undefined)?.recordState?.record;
    expect(record).toBeDefined();
    const serverData = await readServerData();
    expect(record).toStrictEqual(docToRecord(serverData, DATE));
    expect(record?.lastUpdated).toBe((serverData.lastUpdated as Timestamp).toDate().toISOString());
    expect(record?.lastUpdated).not.toBe(BASE_VERSION);
    return record as DailyRecord;
  };

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-atomic-partial-committed-record',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });
    const nurseClaims = { email: 'hospitalizados@hospitalhangaroa.cl', role: 'nurse_hospital' };
    nurseDb = testEnv.authenticatedContext('user_nurse', nurseClaims).firestore();
    otherNurseDb = testEnv.authenticatedContext('user_nurse_2', nurseClaims).firestore();
  });

  beforeEach(async () => {
    // Exercises the client_only atomic transaction, not the authority callable.
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await testEnv.clearFirestore();
    setFirestoreEnabled(true);
    activeDb = nurseDb;
    interleave.attempts = 0;
    interleave.beforeFirstCommit = undefined;
  });

  afterEach(() => {
    stopListener?.();
    stopListener = undefined;
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('returns the committed UPC evaluation and keeps the pre-write history copy', async () => {
    await seed({
      ...buildRecord(),
      beds: {
        R1: buildPatient('R1', {
          upcChecklist: {
            uciCriteria: ['uci_vmi'],
            utiCriteria: [],
            classification: 'UPC_UCI',
            evaluatedAt: BASE_VERSION,
            history: [
              {
                uciCriteria: ['uci_vmi'],
                utiCriteria: [],
                classification: 'UPC_UCI',
                evaluatedAt: BASE_VERSION,
              },
            ],
          },
        }),
      },
      bedTypeOverrides: { R2: 'UCI' },
    });
    await attachCensusListener();

    const receipt = await updateRecordPartial(
      DATE,
      {
        'beds.R1.isUPC': true,
        'beds.R1.upcChecklist': {
          uciCriteria: [],
          utiCriteria: ['uti_sepsis'],
          classification: 'UPC_UTI',
          evaluatedAt: new Date().toISOString(),
          evaluatedForDate: DATE,
          evaluatedBedId: 'R1',
        },
        'bedTypeOverrides.R1': 'UTI',
      },
      BASE_VERSION,
      { requireAtomicCas: true, returnCommittedRecord: true, historyPolicy: 'snapshot' }
    );

    const record = await expectReceiptMatchesServer(receipt);
    expect(record.beds.R1.upcChecklist).not.toHaveProperty('history');
    expect(record.bedTypeOverrides).toEqual({ R1: 'UTI', R2: 'UCI' });
    let historyCount = 0;
    await testEnv.withSecurityRulesDisabled(async context => {
      historyCount = (await context.firestore().collection(`${RECORD_PATH}/history`).get()).size;
    });
    expect(historyCount).toBe(1);
  });

  it.each([
    ['null', { clinicalCrib: null }],
    ['absent', {}],
  ])('returns a crib created into a %s clinicalCrib', async (_label, cribState) => {
    await seed({
      ...buildRecord(),
      beds: { R1: { ...buildPatient('R1', { clinicalEpisodeId: 'madre-ep' }), ...cribState } },
    });
    await attachCensusListener();

    const receipt = await updateRecordPartial(
      DATE,
      {
        'beds.R1.clinicalCrib': buildPatient('R1', {
          bedMode: 'Cuna',
          patientName: 'RN Sintético',
          clinicalEpisodeId: 'rn-ep',
          devices: ['VVP'],
          deviceDetails: {},
        }),
      },
      BASE_VERSION,
      {
        requireAtomicCas: true,
        returnCommittedRecord: true,
        historyPolicy: 'skip',
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: BASE_VERSION,
          confirmedParent: { clinicalEpisodeId: 'madre-ep' },
        },
      }
    );

    const record = await expectReceiptMatchesServer(receipt);
    expect(record.beds.R1.clinicalEpisodeId).toBe('madre-ep');
    expect(record.beds.R1.clinicalCrib).toMatchObject({
      patientName: 'RN Sintético',
      clinicalEpisodeId: 'rn-ep',
    });
  });

  it('returns a Rayen checkpoint merged into a legacy rayenSync, history replaced', async () => {
    const oldRun = {
      id: 'run-old',
      startedAt: BASE_VERSION,
      by: 'rayen@test',
      status: 'applied' as const,
    };
    await seed({
      ...buildRecord(),
      rayenSync: { at: BASE_VERSION, by: 'rayen@test', runId: 'run-old', legacyImportedAt: 'x' },
      rayenSyncHistory: [oldRun],
    });
    await attachCensusListener();
    const at = new Date().toISOString();

    const receipt = await updateRecordPartial(
      DATE,
      {
        rayenSync: { at, by: 'rayen@test', runId: 'run-new', status: 'complete' },
        rayenSyncHistory: [oldRun, { ...oldRun, id: 'run-new', startedAt: at, status: 'complete' }],
      },
      BASE_VERSION,
      { requireAtomicCas: true, returnCommittedRecord: true, historyPolicy: 'skip' }
    );

    const record = await expectReceiptMatchesServer(receipt);
    expect(record.rayenSync).toMatchObject({ runId: 'run-new', status: 'complete', at });
    expect(record.rayenSyncHistory?.map(event => event.id)).toEqual(['run-old', 'run-new']);
    expect((await readServerData()).rayenSync.legacyImportedAt).toBe('x');
  });

  it('returns reclassified movement arrays and an emptied device map', async () => {
    const discharge = { id: 'mov-1', bedId: 'R2', patientName: 'Paciente Egreso', time: '09:00' };
    await seed({
      ...buildRecord(),
      beds: { R1: buildPatient('R1', { deviceDetails: { CVC: { installationDate: DATE } } }) },
      discharges: [discharge],
    });
    await attachCensusListener();

    const receipt = await updateRecordPartial(
      DATE,
      {
        discharges: [],
        cma: [
          {
            id: 'mov-1',
            bedName: 'R2',
            patientName: 'Paciente Egreso',
            rut: '22.222.222-2',
            age: '50a',
            diagnosis: 'Dx sintético',
            specialty: Specialty.MEDICINA,
            interventionType: 'Procedimiento Médico Ambulatorio',
          },
        ],
        'beds.R1.deviceDetails': {},
      },
      BASE_VERSION,
      { requireAtomicCas: true, returnCommittedRecord: true, historyPolicy: 'skip' }
    );

    const record = await expectReceiptMatchesServer(receipt);
    expect(record.discharges).toEqual([]);
    expect((await readServerData()).beds.R1.deviceDetails).toEqual({});
  });

  it('lets exactly one of two writers on the same base commit, with its exact record', async () => {
    await seed({ ...buildRecord(), beds: { R1: buildPatient('R1') } });
    await attachCensusListener();
    const otherPayload = sanitizeForFirestore({
      ...prepareFirestorePartialData({
        partialData: { 'beds.R1.pathology': 'Edición B' },
        specialistScopedPatch: false,
        intentionalBedClear: undefined,
      }),
      lastUpdated: Timestamp.now(),
    }) as DocumentData;

    const [first, second] = await Promise.allSettled([
      updateRecordPartial(DATE, { 'beds.R1.pathology': 'Edición A' }, BASE_VERSION, {
        requireAtomicCas: true,
        returnCommittedRecord: true,
        historyPolicy: 'skip',
      }),
      updateRecordPartiallyAtomically(
        doc(otherNurseDb as unknown as Firestore, RECORD_PATH),
        otherPayload,
        BASE_VERSION,
        'conflict',
        'contention',
        { historyPolicy: 'skip' },
        { getDb: () => otherNurseDb as unknown as Firestore, ready: Promise.resolve() }
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    const loser = first.status === 'rejected' ? first : (second as PromiseRejectedResult);
    expect(loser.reason).toBeInstanceOf(ConcurrencyError);
    if (first.status === 'fulfilled') {
      const record = await expectReceiptMatchesServer(first.value);
      expect(record.beds.R1.pathology).toBe('Edición A');
    } else {
      const committedBase = (second as PromiseFulfilledResult<DocumentData>).value;
      const committed = projectFirestoreUpdate(committedBase, otherPayload);
      expect(committed).toStrictEqual(await readServerData());
      expect(committed.beds.R1.pathology).toBe('Edición B');
    }
  });

  it('returns the record of the attempt that committed after a forced transaction retry', async () => {
    await seed({ ...buildRecord(), beds: { R1: buildPatient('R1') } });
    await attachCensusListener();
    // Another writer lands between the first attempt's read and its commit without moving
    // lastUpdated: the commit fails its precondition and the SDK re-runs the callback.
    interleave.beforeFirstCommit = () =>
      testEnv.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(RECORD_PATH)
          .update({ 'beds.R2': buildPatient('R2', { patientName: 'Ingreso Concurrente' }) });
      });

    const receipt = await updateRecordPartial(
      DATE,
      { 'beds.R1.pathology': 'Dx tras reintento' },
      BASE_VERSION,
      { requireAtomicCas: true, returnCommittedRecord: true, historyPolicy: 'skip' }
    );

    expect(interleave.attempts).toBe(2);
    const record = await expectReceiptMatchesServer(receipt);
    expect(record.beds.R1.pathology).toBe('Dx tras reintento');
    expect(record.beds.R2?.patientName).toBe('Ingreso Concurrente');
  });
});
