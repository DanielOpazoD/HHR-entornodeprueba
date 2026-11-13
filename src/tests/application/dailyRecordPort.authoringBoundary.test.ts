import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';

vi.unmock('@/application/ports/dailyRecordPort');
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => false,
  getFirestoreSyncState: () => ({ mode: 'disabled', reason: 'offline' }),
}));
const loading = vi.hoisted(() => ({ gate: Promise.resolve(), entered: () => {} }));
vi.mock('@/services/runtime/createRecoverableRuntimeLoader', async original => {
  const actual =
    await original<typeof import('@/services/runtime/createRecoverableRuntimeLoader')>();
  return {
    createRecoverableRuntimeLoader: <T>(key: string, load: () => Promise<T>) =>
      actual.createRecoverableRuntimeLoader(key, async () => {
        if (key === 'save-write') {
          loading.entered();
          await loading.gate;
        }
        return load();
      }),
  };
});

const frame = document.createElement('iframe');
document.body.append(frame);
const local = frame.contentWindow!.localStorage;
const session = frame.contentWindow!.sessionStorage;
const date = '2026-11-12';
const patch = { 'beds.R1.pathology': 'SYNTHETIC AUTHOR A EDIT' };
let release!: () => void;
let entered: Promise<void>;
let base = DataFactory.createMockDailyRecord(date);

afterAll(() => frame.remove());
beforeEach(async () => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
  local.clear();
  session.clear();
  const { setSessionGeneration } = await import('@/services/storage/sessionStorageTransition');
  setSessionGeneration('synthetic-A');
  local.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  base = DataFactory.createMockDailyRecord(date);
  base.beds = {
    R1: {
      ...base.beds.R1,
      clinicalEpisodeId: 'synthetic-episode',
      patientName: 'SYNTHETIC PATIENT',
      pathology: 'BASE',
    },
  };
  await hospitalDB.dailyRecords.put(base);
  loading.gate = new Promise(resolve => (release = resolve));
  entered = new Promise(resolve => (loading.entered = resolve));
});
afterEach(async () => {
  release();
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});

// Characterizes the current lazy boundary, including its late attribution. Moving capture
// earlier is a behavior fix: it must not be presented as a behavior-preserving type refactor.
it.each([
  { captureAtEntry: false, change: false },
  { captureAtEntry: true, change: false },
  { captureAtEntry: false, change: true },
  { captureAtEntry: true, change: true },
])(
  'characterizes lazy patch ownership (capture at entry: $captureAtEntry, session change: $change)',
  async ({ captureAtEntry, change }) => {
    const { defaultDailyRecordWritePort: port } =
      await import('@/application/ports/dailyRecordPort');
    const { captureAuthoringSession } = await import('@/services/storage/authoringSession');
    const { setSessionGeneration } = await import('@/services/storage/sessionStorageTransition');
    const options = captureAtEntry ? { authoringSession: captureAuthoringSession() } : undefined;
    const writing = port.updatePartial(date, patch, options);
    await entered;
    if (change) {
      local.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
      setSessionGeneration('synthetic-B');
    }
    release();
    const result = await writing;
    const tasks = await hospitalDB.syncQueue.toArray();
    const stored = await hospitalDB.dailyRecords.get(date);
    const retained = change;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].ownerKey).toBe('user:synthetic-A');
    expect(stored?.beds.R1.pathology).toBe(retained ? 'BASE' : patch['beds.R1.pathology']);
    expect(result.outcome).toBe(retained ? 'unrecoverable' : 'clean');
    process.stdout.write(
      `N2a ${JSON.stringify({ captureAtEntry, change, owner: tasks[0].ownerKey, outcome: result.outcome, pathology: stored?.beds.R1.pathology })}\n`
    );
  }
);
