import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setSessionGeneration,
  getSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { publishSharedStaffCatalog } from '@/services/staff/sharedEloisaStaffCatalog';
const h = vi.hoisted(() => ({
  ready: Promise.resolve(),
  get: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    get ready() {
      return h.ready;
    },
    getDb: () => ({}),
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(),
  runTransaction: h.transaction,
}));
const check = () => {
  if (getSessionGeneration() !== 'session-a') throw new Error('La sesión cambió.');
};
beforeEach(() => {
  vi.resetAllMocks();
  setSessionGeneration('session-a');
  h.ready = Promise.resolve();
  h.get.mockResolvedValue({ data: () => ({ list: [] }) });
  h.transaction.mockImplementation(async (_db, callback) => callback({ get: h.get, set: h.set }));
});
afterEach(() => setSessionGeneration(null));
describe('staff discovery from a clinical run stays in its initiating session', () => {
  it('stops before publishing when runtime readiness crosses into B', async () => {
    let release!: () => void;
    h.ready = new Promise(resolve => {
      release = resolve;
    });
    const pending = publishSharedStaffCatalog([], check);
    setSessionGeneration('session-b');
    release();
    await expect(pending).rejects.toThrow('La sesión cambió.');
    expect(h.set).not.toHaveBeenCalled();
  });
  it('stops before publishing when the transaction reads cross into B', async () => {
    h.get.mockImplementation(async () => {
      setSessionGeneration('session-b');
      return { data: () => ({ list: [] }) };
    });
    await expect(publishSharedStaffCatalog([], check)).rejects.toThrow('La sesión cambió.');
    expect(h.set).not.toHaveBeenCalled();
  });
  it('stops a transaction callback retried under B', async () => {
    h.transaction.mockImplementation(async (_db, callback) => {
      setSessionGeneration('session-b');
      return callback({ get: h.get, set: h.set });
    });
    await expect(publishSharedStaffCatalog([], check)).rejects.toThrow('La sesión cambió.');
    expect(h.set).not.toHaveBeenCalled();
  });
});
