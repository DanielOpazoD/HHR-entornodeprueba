// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolveIndexedDbOpenHealth } from '@/services/storage/indexeddb/indexedDbOpenHealthController';

const createDatabase = ({ isOpen, get }: { isOpen: boolean; get?: () => Promise<unknown> }) => ({
  isOpen: vi.fn(() => isOpen),
  settings: {
    get: vi.fn(get || (() => Promise.resolve(null))),
  },
});

describe('indexedDbOpenHealthController', () => {
  it('reports unopened without touching the health-check table', async () => {
    const database = createDatabase({ isOpen: false });

    await expect(resolveIndexedDbOpenHealth(database)).resolves.toBe('unopened');
    expect(database.settings.get).not.toHaveBeenCalled();
  });

  it('reports ready when the open database accepts the health check', async () => {
    const database = createDatabase({ isOpen: true });

    await expect(resolveIndexedDbOpenHealth(database)).resolves.toBe('ready');
    expect(database.settings.get).toHaveBeenCalledWith('__health_check__');
  });

  it('reports closed when Dexie surfaces a database closed health-check error', async () => {
    const database = createDatabase({
      isOpen: true,
      get: () => Promise.reject({ name: 'DatabaseClosedError' }),
    });

    await expect(resolveIndexedDbOpenHealth(database)).resolves.toBe('closed');
  });

  it('ignores non-closed health-check errors so callers can continue with the open database', async () => {
    const database = createDatabase({
      isOpen: true,
      get: () => Promise.reject({ name: 'QuotaExceededError' }),
    });

    await expect(resolveIndexedDbOpenHealth(database)).resolves.toBe('ready');
  });
});
