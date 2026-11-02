// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://hhr-hospitalizados.app';
const TAB = { origin: ORIGIN, tab: { id: 44 } };
const OTHER_TAB = { origin: ORIGIN, tab: { id: 45 } };

type Authorization = {
  add: (sender: unknown, encounterId: string) => boolean;
  has: (sender: unknown, encounterId: string) => boolean;
  authorizeResponse: (
    sender: unknown,
    response: Promise<unknown>,
    select: (response: unknown) => unknown
  ) => Promise<unknown>;
  revoke: (sender: unknown) => Promise<boolean>;
  capture: (sender: unknown) => (encounterId: string) => boolean;
  ready: Promise<void>;
};

const source = readFileSync('extension/tab-encounter-authorization.js', 'utf8');

/** Each call loads the script anew, as a worker waking up from sleep does. */
const wakeWorker = (storage?: unknown): Authorization => {
  const context: Record<string, unknown> = {};
  context.self = context;
  context.Date = Date;
  vm.createContext(context);
  vm.runInContext(source, context);
  const factory = context.HhrTabEncounterAuthorization as {
    create: (options: unknown) => Authorization;
  };
  return factory.create({ trustedOrigins: new Set([ORIGIN]), storage });
};

const fakeSessionStorage = () => {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => {
      data = JSON.parse(JSON.stringify({ ...data, ...next }));
    }),
  };
};

describe('episode read grants while the extension worker sleeps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the grant of a capture after the worker wakes up', async () => {
    const storage = fakeSessionStorage();
    await wakeWorker(storage).authorizeResponse(
      TAB,
      Promise.resolve({ encounters: ['142040'] }),
      () => [{ encounterId: '142040' }]
    );
    const awake = wakeWorker(storage);
    await awake.ready;
    expect(awake.has(TAB, '142040')).toBe(true);
  });

  it('still limits the restored grant to its tab, its episode and its five minutes', async () => {
    const storage = fakeSessionStorage();
    wakeWorker(storage).add(TAB, '142040');
    const awake = wakeWorker(storage);
    await awake.ready;
    expect(awake.has(OTHER_TAB, '142040')).toBe(false);
    expect(awake.has(TAB, '999999')).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const late = wakeWorker(storage);
    await late.ready;
    expect(late.has(TAB, '142040')).toBe(false);
  });

  it('forgets a grant that a failed capture revoked', async () => {
    const storage = fakeSessionStorage();
    const worker = wakeWorker(storage);
    worker.add(TAB, '142040');
    await worker.authorizeResponse(TAB, Promise.resolve({ error: 'sintético' }), () => null);
    const awake = wakeWorker(storage);
    await awake.ready;
    expect(awake.has(TAB, '142040')).toBe(false);
  });

  it('keeps a grant issued while the stored ones were still loading', async () => {
    const storage = fakeSessionStorage();
    wakeWorker(storage).add(TAB, '111111');
    const awake = wakeWorker(storage);
    awake.add(TAB, '222222');
    await awake.ready;
    expect(awake.has(TAB, '222222')).toBe(true);
  });

  it('denies, without failing, when session storage cannot be read', async () => {
    const worker = wakeWorker({
      get: vi.fn(async () => {
        throw new Error('sintético');
      }),
      set: vi.fn(async () => {
        throw new Error('sintético');
      }),
    });
    await worker.ready;
    expect(worker.has(TAB, '142040')).toBe(false);
    expect(worker.add(TAB, '142040')).toBe(true);
    expect(worker.has(TAB, '142040')).toBe(true);
  });
});

describe('HHR session revocation', () => {
  it('revokes only the trusted tab, persists across sleep and requires fresh evidence', async () => {
    const storage = fakeSessionStorage();
    const worker = wakeWorker(storage);
    await worker.ready;
    worker.add(TAB, '142040');
    worker.add(OTHER_TAB, '222222');
    expect(await worker.revoke({ origin: 'https://untrusted.invalid', tab: TAB.tab })).toBe(false);
    expect(worker.has(TAB, '142040')).toBe(true);
    expect(await worker.revoke(TAB)).toBe(true);
    expect(worker.has(TAB, '142040')).toBe(false);
    const awake = wakeWorker(storage);
    await awake.ready;
    expect(awake.has(TAB, '142040')).toBe(false);
    expect(awake.has(OTHER_TAB, '222222')).toBe(true);
    await awake.authorizeResponse(TAB, Promise.resolve({}), () => [{ encounterId: '333333' }]);
    expect(awake.has(TAB, '142040')).toBe(false);
    expect(awake.has(TAB, '333333')).toBe(true);
  });

  it('fences capture and verified discharge responses that finish after logout', async () => {
    const worker = wakeWorker(fakeSessionStorage());
    await worker.ready;
    let complete!: (value: unknown) => void;
    const response = new Promise(resolve => {
      complete = resolve;
    });
    const pending = worker.authorizeResponse(TAB, response, () => [{ encounterId: '142040' }]);
    const authorizeDischarge = worker.capture(TAB);
    await worker.revoke(TAB);
    complete({});
    await pending;
    expect(authorizeDischarge('142040')).toBe(false);
    expect(worker.has(TAB, '142040')).toBe(false);
    expect(worker.capture(TAB)('222222')).toBe(true);
  });

  it('does not resurrect storage read before a revocation while waking', async () => {
    let restore!: (value: unknown) => void;
    const storage = {
      get: () =>
        new Promise(resolve => {
          restore = resolve;
        }),
      set: vi.fn(async () => {}),
    };
    const worker = wakeWorker(storage);
    const revoked = worker.revoke(TAB);
    restore({
      hhrTabEncounterAuthorization: [
        [44, { encounterIds: ['142040'], expiresAt: Date.now() + 300000 }],
      ],
    });
    await revoked;
    expect(worker.has(TAB, '142040')).toBe(false);
    expect(storage.set).toHaveBeenLastCalledWith({ hhrTabEncounterAuthorization: [] });
  });
});
