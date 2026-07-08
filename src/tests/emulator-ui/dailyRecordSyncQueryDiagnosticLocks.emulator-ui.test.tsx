/* @flake-safe: Date usage is deterministic for test boundaries */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { clearAllRecords, saveRecord } from '@/services/storage/indexedDBService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import {
  getDailyRecordFreshnessStatus,
  markDailyRecordStaleBaseline,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';

const runEmulatorUiTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeUiEmulator = runEmulatorUiTests ? describe : describe.skip;

const mockNotifyWarning = vi.fn();
const TODAY_ISO = new Date().toISOString().slice(0, 10);

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: mockNotifyWarning,
    info: vi.fn(),
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

describeUiEmulator('UI sync flow silent refresh with Firestore emulator', () => {
  let testEnv: RulesTestEnvironment;
  const unmounts: Array<() => void> = [];

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-ui-sync-diagnostic-locks-test',
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

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows a new diagnostic group edit after a realtime snapshot confirms the refreshed record', async () => {
    const date = TODAY_ISO;
    const seed = buildRecord(date, 'Paciente Diagnostico', 'Diag Inicial');
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
      throw new Error('Failed to initialize diagnostic lock harness');
    }
    unmounts.push(safeUnmount);
    const resultRef = safeResult as {
      current: {
        record: DailyRecord | null;
        patchRecord: (patch: Record<string, unknown>) => Promise<void>;
      };
    };

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.pathology).toBe('Diag Inicial');
    });

    await act(async () => {
      markDailyRecordTabHidden(0);
      markDailyRecordTabVisible(6 * 60 * 1000);
      markDailyRecordStaleBaseline(date, resultRef.current.record);
    });

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
        'beds.R1.cie10Code': 'I10',
      });
    });

    await waitFor(() => {
      expect(resultRef.current.record?.beds?.R1?.cie10Code).toBe('I10');
    });

    expect(mockNotifyWarning).not.toHaveBeenCalled();

    let remoteSnap: { data: () => Record<string, unknown> | undefined } | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      remoteSnap = await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).get();
    });
    const remoteData = remoteSnap?.data() as {
      beds?: Record<string, { cie10Code?: string; pathology?: string }>;
    };
    expect(remoteData?.beds?.R1?.pathology).toBe('Diag confirmado por cliente A');
    expect(remoteData?.beds?.R1?.cie10Code).toBe('I10');
  });
});
