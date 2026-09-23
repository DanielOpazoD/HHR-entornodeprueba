import { vi } from 'vitest';

import '../../../extension/relay-reinjection-manifest.js';
import '../../../extension/relay-reinjection-health.js';
import '../../../extension/relay-reinjection-operations.js';
import '../../../extension/relay-reinjection-session.js';
import '../../../extension/relay-reinjection-runtime.js';

type ReinjectionRuntime = {
  create: (deps: Record<string, unknown>) => {
    start: () => boolean;
    reinjectRelays: () => Promise<{
      injectedTabs: number;
      failedTabs: number;
      complete: boolean;
    }>;
    reinjectTab: (target: { tabId: number; requiredFile: string }) => Promise<{
      injected: boolean;
      reason?: string;
    }>;
    reinjectRelay: (requiredFile: string) => Promise<{
      injectedTabs: number;
      failedTabs: number;
      complete: boolean;
    }>;
    ensureReinjected: (options?: { force?: boolean }) => Promise<{
      injectedTabs: number;
      skipped: boolean;
      failedTabs?: number;
      complete?: boolean;
    }>;
    repairActivatedTab: (tabId: number) => Promise<{ injected: boolean; healthy?: boolean }>;
  };
  STORAGE_KEY: string;
};

export const runtimeModule = (
  globalThis as unknown as { HhrRelayReinjectionRuntime: ReinjectionRuntime }
).HhrRelayReinjectionRuntime;

export const MANIFEST = {
  version: '0.48.31',
  content_scripts: [
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: [
        'fichamedico-isolation-normalization.js',
        'fichamedico-treating-physician-dom.js',
        'fichamedico-treating-physician-sources.js',
        'fichamedico-treating-physician-normalization.js',
        'fichamedico-normalization.js',
        'fichamedico-read-resilience.js',
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-fichamedico.js',
      ],
      world: 'MAIN',
    },
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: ['message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    },
    {
      matches: ['https://hospitalizado.rayensalud.cl/*'],
      js: ['bridge-generation-main.js', 'connection-relay-recovery.js', 'inject-gestioncamas.js'],
      world: 'MAIN',
    },
    {
      matches: ['https://hospitalizado.rayensalud.cl/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'gestion-camas-bridge-health.js',
        'health-push-ordering-runtime.js',
        'hhr-connection-action-model.js',
        'hhr-connection-presentation.js',
        'gestion-camas-connection-indicator.js',
        'gestion-camas-connection-indicator-bootstrap.js',
        'content-gestioncamas.js',
      ],
    },
    {
      matches: ['http://localhost:3001/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'content-hhr-sync-bundle.js',
        'content-hhr-connection-repair.js',
        'content-hhr.js',
        'content-hhr-patient-flow.js',
        'content-hhr-epicrisis.js',
        'content-hhr-patient-documents.js',
        'content-hhr-statistical-discharge.js',
        'content-hhr-statistical-evidence.js',
        'content-hhr-syslab.js',
      ],
    },
    {
      matches: ['http://10.4.69.90/syslab/*'],
      js: ['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js'],
      all_frames: true,
    },
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: [
        'message-contract.js',
        'hhr-ui.js',
        'hhr-connection-presentation.js',
        'hhr-prescription-content-runtime.js',
        'content-prescription-print.js',
      ],
    },
  ],
};

export const createFixture = () => {
  const installedListeners: Array<() => void> = [];
  const activatedListeners: Array<(event: { tabId: number }) => void> = [];
  const executeScript = vi.fn(
    async (injection: {
      target: { tabId: number; allFrames: boolean };
      files?: string[];
      func?: () => unknown;
    }) =>
      injection.func ? [{ frameId: 0, result: 'http://10.4.69.90/syslab/index.php' }] : undefined
  );
  const sessionState: Record<string, unknown> = {};
  const chromeApi = {
    runtime: {
      getManifest: () => MANIFEST,
      onInstalled: {
        addListener: vi.fn((listener: () => void) => installedListeners.push(listener)),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionState, values)),
      },
    },
    tabs: {
      onActivated: {
        addListener: vi.fn((listener: (event: { tabId: number }) => void) =>
          activatedListeners.push(listener)
        ),
      },
      query: vi.fn(async ({ url }: { url: string[] }) =>
        url.includes('https://fichamedico.rayensalud.cl/*')
          ? [{ id: 5, url: 'https://fichamedico.rayensalud.cl/dashboard' }]
          : url.includes('https://hospitalizado.rayensalud.cl/*')
            ? [{ id: 6, url: 'https://hospitalizado.rayensalud.cl/#/bed' }]
            : url.includes('http://10.4.69.90/syslab/*')
              ? [{ id: 9, url: 'http://10.4.69.90/syslab/index.php' }]
              : [{ id: 8, url: 'http://localhost:3001/census' }]
      ),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url:
          tabId === 5
            ? 'https://fichamedico.rayensalud.cl/dashboard'
            : tabId === 6
              ? 'https://hospitalizado.rayensalud.cl/#/bed'
              : tabId === 9
                ? 'http://10.4.69.90/syslab/index.php'
                : 'http://localhost:3001/census',
      })),
      sendMessage: vi.fn(
        async (tabId: number, message?: { type?: string }, _options?: { frameId?: number }) =>
          message?.type === 'RAYEN_SYSLAB_STATUS'
            ? { ok: true, bridgeId: 'syslab-test' }
            : message?.type === 'RAYEN_EXTENSION_INDICATOR_PING'
              ? { indicatorReady: true }
              : message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING'
                ? { uiReady: true }
                : { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' }
      ),
    },
    scripting: { executeScript },
  };
  const onReinjected = vi.fn(async () => undefined);
  const withTimeout = vi.fn(async (promise: Promise<unknown>) => promise);
  const runtime = runtimeModule.create({
    chromeApi,
    onReinjected,
    log: vi.fn(),
    timeoutMs: 5_000,
    withTimeout,
  });
  return {
    runtime,
    chromeApi,
    executeScript,
    onReinjected,
    withTimeout,
    installedListeners,
    activatedListeners,
    sessionState,
  };
};
