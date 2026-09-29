import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as health from '@/features/rayen-import/bridge/extensionHealthBridge';
import {
  requestDeviceReport,
  requestHistoryScales,
  requestScalesReport,
  requestCudyrCategories,
  requestPatientClinicalBundle,
} from '@/features/rayen-import/bridge/rayenImportBridge';

const channels = [
  {
    name: 'devices',
    read: () => requestDeviceReport('synthetic', '2026-09-28'),
    empty: { entries: [], source: 'json' },
    malformed: { entries: null },
  },
  {
    name: 'history',
    read: () => requestHistoryScales('synthetic', '2026-09-28'),
    empty: { events: [] },
    malformed: { events: {} },
  },
  {
    name: 'forms',
    read: () => requestScalesReport('synthetic'),
    empty: { forms: [] },
    malformed: { forms: false },
  },
  {
    name: 'CUDYR',
    read: () => requestCudyrCategories(),
    empty: { items: [] },
    malformed: { items: 'invalid' },
  },
];
let response: Record<string, unknown>;
beforeEach(() => {
  response = {};
  vi.spyOn(health, 'hasRayenExtensionCapability').mockReturnValue(true);
  vi.spyOn(window, 'postMessage').mockImplementation(message => {
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type: String(message.type).replace(/_REQUEST$/, '_RESULT'),
            reqId: message.reqId,
            ...response,
          },
        })
      )
    );
  });
});
afterEach(() => vi.restoreAllMocks());

describe('clinical source evidence at the real message boundary', () => {
  it.each(channels)(
    '$name rejects a missing collection instead of confirming absence',
    async ({ read }) => {
      expect((await read()).error).toBeTruthy();
    }
  );
  it.each(channels)('$name rejects malformed collections', async ({ read, malformed }) => {
    response = malformed;
    expect((await read()).error).toBeTruthy();
  });
  it.each(channels)('$name accepts explicit empty evidence', async ({ read, empty }) => {
    response = empty;
    expect((await read()).error).toBeUndefined();
  });
  it.each(channels)('$name preserves the source error', async ({ read }) => {
    response = { error: 'Fuente temporalmente no disponible' };
    expect((await read()).error).toBe('Fuente temporalmente no disponible');
  });
  it('rejects an explicitly malformed nursing collection while keeping legacy omission valid', async () => {
    response = { events: [], nursingActivity: null };
    expect((await requestHistoryScales('synthetic', '2026-09-28')).error).toBeTruthy();
  });
  it('accepts legacy device PDF evidence', async () => {
    response = { base64: 'JVBERg==' };
    expect((await requestDeviceReport('synthetic', '2026-09-28')).error).toBeUndefined();
  });
  it('marks malformed bundle sections independently while preserving successful siblings', async () => {
    response = { devices: {}, history: { events: [] }, forms: [] };
    const bundle = await requestPatientClinicalBundle('synthetic', '2026-09-28');
    expect(bundle?.devices.error).toBeTruthy();
    expect(bundle?.history.error).toBeUndefined();
    expect(bundle?.forms.error).toBeTruthy();
  });
});
