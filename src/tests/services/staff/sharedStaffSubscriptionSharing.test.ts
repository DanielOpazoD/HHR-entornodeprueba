import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  liveQuery: vi.fn(() => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })),
  isFirestoreEnabled: vi.fn(() => true),
  subscribeShared: vi.fn(() => vi.fn()),
}));
vi.mock('dexie', () => ({ liveQuery: mocks.liveQuery }));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));
vi.mock('@/services/staff/sharedEloisaStaffCatalog', () => ({
  subscribeSharedStaffCatalog: mocks.subscribeShared,
}));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  ensureDbReady: vi.fn(async () => {}),
  hospitalDB: {
    catalogs: { get: vi.fn(async () => undefined), put: vi.fn() },
    transaction: vi.fn(),
  },
}));

const load = async () =>
  (await import('@/services/staff/eloisaStaffRegistry')).subscribeEloisaStaff;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

describe('shared Eloisa staff catalog subscription', () => {
  it('opens one remote listener for several consumers of the same document', async () => {
    const subscribe = await load();
    const first = subscribe(vi.fn(), vi.fn(), true);
    const second = subscribe(vi.fn(), vi.fn(), true);
    await flush();
    expect(mocks.subscribeShared).toHaveBeenCalledTimes(1);
    first();
    second();
  });

  it('closes the remote listener only when the last consumer leaves', async () => {
    const release = vi.fn();
    mocks.subscribeShared.mockReturnValue(release);
    const subscribe = await load();
    const first = subscribe(vi.fn(), vi.fn(), true);
    const second = subscribe(vi.fn(), vi.fn(), true);
    await flush();
    first();
    expect(release).not.toHaveBeenCalled();
    second();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reopens after every consumer left, and never opens without the shared flag', async () => {
    mocks.subscribeShared.mockReturnValue(vi.fn());
    const subscribe = await load();
    const first = subscribe(vi.fn(), vi.fn(), true);
    await flush();
    first();
    const second = subscribe(vi.fn(), vi.fn(), true);
    await flush();
    expect(mocks.subscribeShared).toHaveBeenCalledTimes(2);
    second();
    const local = subscribe(vi.fn(), vi.fn(), false);
    await flush();
    expect(mocks.subscribeShared).toHaveBeenCalledTimes(2);
    local();
  });

  it('does not leak a listener when the last consumer leaves before it resolves', async () => {
    const release = vi.fn();
    mocks.subscribeShared.mockReturnValue(release);
    const subscribe = await load();
    const only = subscribe(vi.fn(), vi.fn(), true);
    only();
    await flush();
    expect(mocks.subscribeShared).not.toHaveBeenCalled();
  });
});
