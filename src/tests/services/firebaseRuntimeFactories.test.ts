import { describe, expect, it, vi } from 'vitest';

import { createAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { createFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { createStorageRuntime } from '@/services/firebase-runtime/storageRuntime';
import { createBackupFirestoreRuntime } from '@/services/firebase-runtime/backupRuntime';
import { createReminderFirestoreRuntime } from '@/services/firebase-runtime/reminderRuntime';
import type { FirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

const createAdapterStub = (): FirebaseConfigRuntimeAdapter => {
  const auth = { currentUser: { email: 'test@hospital.cl' } };
  const db = { name: 'db' };
  const functions = { name: 'functions' };
  const storage = { name: 'storage' };

  return {
    ready: Promise.resolve(),
    readyFirestore: Promise.resolve(),
    getApp: () => ({ name: 'app' }) as never,
    getOptionalApp: () => ({ name: 'app' }) as never,
    getAuth: () => auth as never,
    getOptionalAuth: () => auth as never,
    getDb: () => db as never,
    getOptionalDb: () => db as never,
    getFunctions: vi.fn(async () => functions as never),
    getRegionalFunctions: vi.fn(async () => functions as never),
    getStorage: vi.fn(async () => storage as never),
  };
};

describe('firebase runtime factories', () => {
  it('creates an auth runtime from an injected adapter', async () => {
    const adapter = createAdapterStub();
    const runtime = createAuthRuntime(adapter);

    await expect(runtime.ready).resolves.toBeUndefined();
    expect(runtime.auth).toBe(adapter.getAuth());
    expect(runtime.getCurrentUser()?.email).toBe('test@hospital.cl');
  });

  it('creates functions and storage runtimes from an injected adapter', async () => {
    const adapter = createAdapterStub();
    const functionsRuntime = createFunctionsRuntime(adapter);
    const storageRuntime = createStorageRuntime(adapter);

    await expect(functionsRuntime.getFunctions()).resolves.toEqual({ name: 'functions' });
    await expect(storageRuntime.getStorage()).resolves.toEqual({ name: 'storage' });
  });

  it('creates backup and reminder runtimes from an injected adapter', () => {
    const adapter = createAdapterStub();
    const backupRuntime = createBackupFirestoreRuntime(adapter);
    const reminderRuntime = createReminderFirestoreRuntime(adapter);

    expect(backupRuntime.auth.currentUser?.email).toBe('test@hospital.cl');
    expect(backupRuntime.db).toEqual({ name: 'db' });
    expect(reminderRuntime.firestore).toEqual({ name: 'db' });
  });
});
