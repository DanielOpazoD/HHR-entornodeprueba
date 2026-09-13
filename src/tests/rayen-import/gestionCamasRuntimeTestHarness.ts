// @vitest-environment node
import { vi } from 'vitest';

import '../../../extension/health-check.js';
import '../../../extension/gestion-camas-session.js';
import '../../../extension/gestion-camas-health.js';
import '../../../extension/gestion-camas-runtime.js';

type StoredValues = Record<string, unknown>;
// The default unit fixture models freshness as a finite session timestamp.
// Lifecycle regressions below opt into the real session owner, including expiry.
export const FINITE_SESSION_TIMESTAMP = 1;

export const createFixture = (
  initial: StoredValues = {},
  options: { tabs?: Array<{ id: number; windowId?: number }>; fullLifecycle?: boolean } = {}
) => {
  const values: StoredValues = { ...initial };
  const storage = {
    get: vi.fn(async (key: string | null) => {
      if (key === null) return { ...values };
      return { [key]: values[key] };
    }),
    set: vi.fn(async (entries: StoredValues) => {
      Object.assign(values, entries);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
  const session = {
    SESSION_STORAGE_KEY: 'gc-session',
    PENDING_WINDOW_STORAGE_KEY: 'gc-pending',
    CONNECTION_CONTROL_STORAGE_KEY: 'gc-control',
    CLOSING_WINDOW_STORAGE_KEY: 'gc-closing',
    buildSessionRecord: (info: Record<string, unknown>) =>
      info?.accessValue && info?.apiBase && info?.facId
        ? {
            accessValue: info.accessValue,
            apiBase: info.apiBase,
            facId: info.facId,
            capturedAt: FINITE_SESSION_TIMESTAMP,
            lastVerifiedAt: null,
            expiresAt: null,
            identity: {},
          }
        : null,
    isUsable: (record: Record<string, unknown> | null) =>
      Boolean(record?.accessValue && record?.apiBase && record?.facId),
    isVerificationFresh: (record: Record<string, unknown> | null) =>
      Number.isFinite(record?.lastVerifiedAt),
    publicStatus: (record: Record<string, unknown> | null) => ({
      status: record ? 'ready' : 'missing',
      connected: Boolean(record),
    }),
  };
  const chromeApi = {
    storage: { session: storage },
    tabs: {
      query: vi.fn(async () => options.tabs ?? [{ id: 7 }]),
      get: vi.fn(async (id: number) => (options.tabs ?? [{ id: 7 }]).find(tab => tab.id === id)),
      sendMessage: vi.fn(
        async (
          _id: number,
          _message: Record<string, unknown>
        ): Promise<Record<string, unknown>> => ({ ready: true, message: 'Pestaña disponible.' })
      ),
      update: vi.fn(),
    },
    windows: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => undefined),
    },
  };
  const runtimeFactory = (
    globalThis as typeof globalThis & {
      HhrGestionCamasRuntime: {
        create: (dependencies: Record<string, unknown>) => {
          captureSession: (info: Record<string, unknown>, sender: unknown) => Promise<unknown>;
          classifyRejection: (
            response: { status: number },
            record: Record<string, unknown>
          ) => Promise<string>;
          health: (
            runtimeGeneration?: string,
            targetTabIds?: number[]
          ) => Promise<Record<string, unknown>>;
          connect: (options?: { renew?: boolean }) => Promise<Record<string, unknown>>;
          disconnect: () => Promise<Record<string, unknown>>;
        };
      };
    }
  ).HhrGestionCamasRuntime;

  const fetchWithTimeout = vi.fn();
  const probeTabs = vi.fn(async ({ tabs }: { tabs: unknown[] }) =>
    tabs.length > 0
      ? { status: 'ready', message: 'Pestaña disponible.' }
      : { status: 'missing', message: 'Abre Gestión de Camas.' }
  );
  const runtime = runtimeFactory.create({
    chrome: chromeApi,
    session: options.fullLifecycle
      ? {
          ...(globalThis as typeof globalThis & { HhrGestionCamasSession: Record<string, unknown> })
            .HhrGestionCamasSession,
          SESSION_STORAGE_KEY: session.SESSION_STORAGE_KEY,
          PENDING_WINDOW_STORAGE_KEY: session.PENDING_WINDOW_STORAGE_KEY,
          CONNECTION_CONTROL_STORAGE_KEY: session.CONNECTION_CONTROL_STORAGE_KEY,
          CLOSING_WINDOW_STORAGE_KEY: session.CLOSING_WINDOW_STORAGE_KEY,
        }
      : session,
    extensionHealth: options.fullLifecycle
      ? (globalThis as typeof globalThis & { HhrExtensionHealth: Record<string, unknown> })
          .HhrExtensionHealth
      : {
          orderTabs: (tabs: unknown[]) => tabs,
          resolveTabs: async (
            tabsApi: {
              query: (query: unknown) => Promise<unknown[]>;
              get: (id: number) => Promise<unknown>;
            },
            url: string,
            targetTabIds?: number[]
          ) =>
            Array.isArray(targetTabIds)
              ? (await Promise.all(targetTabIds.map(id => tabsApi.get(id)))).filter(Boolean)
              : tabsApi.query({ url }),
          probeTabs,
        },
    withTimeout: (promise: Promise<unknown>) => promise,
    fetchWithTimeout,
    backendRequestTimeoutMs: 45_000,
    tabMessageTimeoutMs: 50_000,
    healthProbeTimeoutMs: 5_000,
  });

  return { runtime, values, storage, fetchWithTimeout, chromeApi, probeTabs };
};
