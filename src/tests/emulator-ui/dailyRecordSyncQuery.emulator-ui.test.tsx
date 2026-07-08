/* @flake-safe: Date usage is deterministic for test boundaries */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { clearAllRecords, getRecordForDate, saveRecord } from '@/services/storage/indexedDBService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import {
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';

const runEmulatorUiTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeUiEmulator = runEmulatorUiTests ? describe : describe.skip;

const mockNotifyError = vi.fn();
const mockNotifySuccess = vi.fn();
const mockNotifyWarning = vi.fn();
const mockNotifyInfo = vi.fn();
const TODAY_ISO = new Date().toISOString().slice(0, 10);

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    error: mockNotifyError,
    success: mockNotifySuccess,
    warning: mockNotifyWarning,
    info: mockNotifyInfo,
    notify: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
    notifications: [],
  }),
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({
    checkVersion: vi.fn(),
    checkRuntimeContract: vi.fn(),
    isOutdated: false,
    appVersion: 1,
    remoteVersion: null,
    updateReason: 'current',
    runtimeContract: null,
    forceUpdate: vi.fn(),
  }),
}));

vi.mock('@/services/storage/migration/legacyRecordReadBridge', () => ({
  getLegacyRecord: vi.fn().mockResolvedValue(null),
}));

let activeDb: unknown;
const currentUser = {
  email: 'hospitalizados@hospitalhangaroa.cl',
  uid: 'user_nurse',
  displayName: 'Test Nurse',
};

vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: {
    get currentUser() {
      return currentUser;
    },
  },
  storage: {},
  functions: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
  firebaseReady: Promise.resolve(),
  mountConfigWarning: vi.fn(),
}));

const buildRecord = (date: string, patientName: string, pathology: string): DailyRecord =>
  ({
    date,
    beds: {
      R1: {
        bedId: 'R1',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName,
        rut: '11.111.111-1',
        age: '40a',
        pathology,
        specialty: 'Med Interna',
        status: 'Estable',
        admissionDate: date,
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    schemaVersion: 1,
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    handoffDayChecklist: {},
    handoffNightChecklist: {},
  }) as unknown as DailyRecord;

describeUiEmulator('UI sync flow with Firestore emulator', () => {
  let testEnv: RulesTestEnvironment;
  const unmounts: Array<() => void> = [];

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-ui-sync-emulator-test',
      firestore: {
        rules,
        host: emulatorConfig.host,
        port: emulatorConfig.port,
      },
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await testEnv.clearFirestore();
    await clearAllRecords();
    resetDailyRecordFreshnessGateForTests();
    clearPendingDailyRecordPatchesForTests();
    setFirestoreEnabled(true);

    activeDb = testEnv
      .authenticatedContext('user_nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  afterEach(async () => {
    await act(async () => {
      while (unmounts.length > 0) {
        const unmount = unmounts.pop();
        unmount?.();
      }
      await Promise.resolve();
    });
    clearPendingDailyRecordPatchesForTests();
  });

  it('loads record from emulator and reflects remote updates via subscription', async () => {
    const date = TODAY_ISO;
    const seed = buildRecord(date, 'Paciente Inicial', 'Diag Inicial');

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(seed);
    });

    const { wrapper } = createQueryClientTestWrapper();
    let safeResult: { current: unknown } | null = null;
    let safeUnmount: (() => void) | null = null;
    await act(async () => {
      const hook = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), { wrapper });
      safeResult = hook.result;
      safeUnmount = hook.unmount;
    });
    if (!safeResult || !safeUnmount) {
      throw new Error('Failed to initialize realtime hook test harness');
    }
    const resultRef = safeResult as { current: { record: DailyRecord | null } };
    unmounts.push(safeUnmount);

    await waitFor(
      () => {
        expect(resultRef.current.record?.beds?.R1?.patientName).toBe('Paciente Inicial');
      },
      { timeout: 5000 }
    );

    await act(async () => {
      await testEnv.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
          .set(
            {
              ...seed,
              beds: {
                ...seed.beds,
                R1: { ...seed.beds.R1, patientName: 'Paciente Remoto', pathology: 'Diag Remoto' },
              },
              lastUpdated: `${date}T10:10:00.000Z`,
            },
            { merge: true }
          );
      });
    });

    await waitFor(
      () => {
        expect(resultRef.current.record?.beds?.R1?.patientName).toBe('Paciente Remoto');
        expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Remoto');
      },
      { timeout: 5000 }
    );
  });

  it('patches from UI hook and persists changes to Firestore + IndexedDB', async () => {
    const date = TODAY_ISO;
    const seed = buildRecord(date, 'Paciente Local', 'Diag Base');

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(seed);
    });
    await saveRecord(seed);

    const { wrapper } = createQueryClientTestWrapper();
    let safeResult: { current: unknown } | null = null;
    let safeUnmount: (() => void) | null = null;
    await act(async () => {
      const hook = renderHook(() => useDailyRecordSyncQuery(date, false, 'local_only'), {
        wrapper,
      });
      safeResult = hook.result;
      safeUnmount = hook.unmount;
    });
    if (!safeResult || !safeUnmount) {
      throw new Error('Failed to initialize patch hook test harness');
    }
    const resultRef = safeResult as {
      current: {
        record: DailyRecord | null;
        patchRecord: (patch: Record<string, unknown>) => Promise<void>;
      };
    };
    unmounts.push(safeUnmount);

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Base');
    });

    await act(async () => {
      await resultRef.current.patchRecord({
        'beds.R1.pathology': 'Diag UI Patch',
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag UI Patch');
    });

    let remoteSnap: { data: () => Record<string, unknown> | undefined } | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      remoteSnap = await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).get();
    });
    const remoteData = remoteSnap?.data() as { beds?: Record<string, { pathology?: string }> };
    expect(remoteData?.beds?.R1?.pathology).toBe('Diag UI Patch');

    const local = await getRecordForDate(date);
    expect(local?.beds?.R1?.pathology).toBe('Diag UI Patch');
  });

  it('hydrates a newer Firebase record before accepting a stale local client patch', async () => {
    const date = TODAY_ISO;
    const staleClientRecord = buildRecord(date, 'Paciente Cliente B', 'Diag Cliente B stale');
    const remoteBaseline = buildRecord(date, 'Paciente Cliente B', 'Diag Base Firebase');
    const remoteUpdatedByOtherClient = {
      ...remoteBaseline,
      beds: {
        ...remoteBaseline.beds,
        R1: {
          ...remoteBaseline.beds.R1,
          pathology: 'Diag Firebase actualizado por A',
        },
      },
      lastUpdated: `${date}T10:30:00.000Z`,
    };

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remoteBaseline);
    });
    await saveRecord(staleClientRecord);

    const { wrapper } = createQueryClientTestWrapper();
    let safeResult: { current: unknown } | null = null;
    let safeUnmount: (() => void) | null = null;
    await act(async () => {
      const hook = renderHook(() => useDailyRecordSyncQuery(date, false, 'local_only'), {
        wrapper,
      });
      safeResult = hook.result;
      safeUnmount = hook.unmount;
    });
    if (!safeResult || !safeUnmount) {
      throw new Error('Failed to initialize stale client patch harness');
    }
    const resultRef = safeResult as {
      current: {
        record: DailyRecord | null;
        patchRecord: (patch: Record<string, unknown>) => Promise<void>;
      };
    };
    unmounts.push(safeUnmount);

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Cliente B stale');
    });

    markDailyRecordTabHidden(0);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(remoteUpdatedByOtherClient);
    });
    markDailyRecordTabVisible(6 * 60 * 1000);

    await act(async () => {
      await resultRef.current.patchRecord({
        'beds.R1.status': 'Grave',
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Firebase actualizado por A');
      expect(resultRef.current.record?.beds?.R1?.status).toBe('Grave');
    });
    expect(mockNotifyWarning).not.toHaveBeenCalledWith(
      'Censo en actualización',
      expect.stringContaining('Revise los datos antes de editar')
    );

    let remoteSnap: { data: () => Record<string, unknown> | undefined } | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      remoteSnap = await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).get();
    });
    const remoteData = remoteSnap?.data() as {
      beds?: Record<string, { pathology?: string; status?: string }>;
    };
    expect(remoteData?.beds?.R1?.pathology).toBe('Diag Firebase actualizado por A');
    expect(remoteData?.beds?.R1?.status).toBe('Grave');

    const local = await getRecordForDate(date);
    expect(local?.beds?.R1?.pathology).toBe('Diag Firebase actualizado por A');
    expect(local?.beds?.R1?.status).toBe('Grave');
  });

  it('lets a stale resumed client edit only after the realtime snapshot from another client confirms Firebase', async () => {
    const date = TODAY_ISO;
    const seed = buildRecord(date, 'Paciente Dos Clientes', 'Diag Inicial');
    const updatedByClientA = {
      ...seed,
      beds: {
        ...seed.beds,
        R1: {
          ...seed.beds.R1,
          pathology: 'Diag confirmado por cliente A',
        },
      },
      lastUpdated: `${date}T10:45:00.000Z`,
    };

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(seed);
    });
    await saveRecord(seed);

    const { wrapper } = createQueryClientTestWrapper();
    let safeResult: { current: unknown } | null = null;
    let safeUnmount: (() => void) | null = null;
    await act(async () => {
      const hook = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), { wrapper });
      safeResult = hook.result;
      safeUnmount = hook.unmount;
    });
    if (!safeResult || !safeUnmount) {
      throw new Error('Failed to initialize two-client freshness harness');
    }
    const resultRef = safeResult as {
      current: {
        record: DailyRecord | null;
        patchRecord: (patch: Record<string, unknown>) => Promise<void>;
      };
    };
    unmounts.push(safeUnmount);

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Inicial');
    });

    await act(async () => {
      markDailyRecordTabHidden(0);
      markDailyRecordTabVisible(6 * 60 * 1000);
    });
    expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');

    await act(async () => {
      await testEnv.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
          .set(updatedByClientA);
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag confirmado por cliente A');
      expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
    });

    await act(async () => {
      await resultRef.current.patchRecord({
        'beds.R1.status': 'Grave',
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.status).toBe('Grave');
    });

    let remoteSnap: { data: () => Record<string, unknown> | undefined } | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      remoteSnap = await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).get();
    });
    const remoteData = remoteSnap?.data() as {
      beds?: Record<string, { pathology?: string; status?: string }>;
    };
    expect(remoteData?.beds?.R1?.pathology).toBe('Diag confirmado por cliente A');
    expect(remoteData?.beds?.R1?.status).toBe('Grave');
  });

  it('keeps the current day record visible when Firestore emits a missing document after it was loaded', async () => {
    const date = TODAY_ISO;
    const seed = buildRecord(date, 'Paciente Persistente', 'Diag Persistente');

    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(seed);
    });

    const { wrapper } = createQueryClientTestWrapper();
    let safeResult: { current: unknown } | null = null;
    let safeUnmount: (() => void) | null = null;
    await act(async () => {
      const hook = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), { wrapper });
      safeResult = hook.result;
      safeUnmount = hook.unmount;
    });
    if (!safeResult || !safeUnmount) {
      throw new Error('Failed to initialize missing-document recovery harness');
    }
    const resultRef = safeResult as { current: { record: DailyRecord | null } };
    unmounts.push(safeUnmount);

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.patientName).toBe('Paciente Persistente');
    });

    await act(async () => {
      await testEnv.withSecurityRulesDisabled(async context => {
        await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).delete();
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.patientName).toBe('Paciente Persistente');
    });
  });
});
