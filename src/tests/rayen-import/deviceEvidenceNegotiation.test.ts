import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as extensionHealth from '@/features/rayen-import/bridge/extensionHealthBridge';
import {
  requestPatientClinicalBundle,
  RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST_TYPE,
  RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT_TYPE,
} from '@/features/rayen-import/bridge/patientClinicalBundleChannel';
import {
  RAYEN_DEVICE_REPORT_REQUEST_TYPE,
  RAYEN_DEVICE_REPORT_RESULT_TYPE,
  requestDeviceReport,
} from '@/features/rayen-import/bridge/rayenImportBridge';

describe('device evidence capability negotiation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('negotiates JSON in the bundled channel too, preserving the normalized section', async () => {
    vi.spyOn(extensionHealth, 'hasRayenExtensionCapability').mockReturnValue(true);
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(message => {
      queueMicrotask(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: window.location.origin,
            data: {
              type: RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT_TYPE,
              reqId: message.reqId,
              devices: { entries: [], source: 'json' },
              history: { events: [] },
              forms: { forms: [] },
            },
          })
        )
      );
    });
    await expect(
      requestPatientClinicalBundle('synthetic-episode', '2026-09-05', {}, 100)
    ).resolves.toMatchObject({ devices: { entries: [], source: 'json' } });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST_TYPE,
        acceptEntries: true,
      }),
      window.location.origin
    );
  });

  it('does not contact an extension without bundle support', async () => {
    vi.spyOn(extensionHealth, 'hasRayenExtensionCapability').mockReturnValue(false);
    const postMessage = vi.spyOn(window, 'postMessage');
    await expect(
      requestPatientClinicalBundle('synthetic-episode', '2026-09-05')
    ).resolves.toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('has the new page explicitly request structured entries', async () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(message => {
      const request = message as { reqId: string; acceptEntries?: boolean };
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: window.location.origin,
            data: {
              type: RAYEN_DEVICE_REPORT_RESULT_TYPE,
              reqId: request.reqId,
              entries: [],
              base64: '',
              source: 'json',
            },
          })
        );
      });
    });

    await expect(requestDeviceReport('episode-1', '2026-07-29', 100)).resolves.toMatchObject({
      source: 'json',
      entries: [],
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RAYEN_DEVICE_REPORT_REQUEST_TYPE,
        acceptEntries: true,
      }),
      window.location.origin
    );
  });

  it('has the extension preserve PDF compatibility unless the page opts in', () => {
    const source = readFileSync(path.resolve('extension/content-hhr.js'), 'utf8');

    expect(source).toContain('acceptEntries: data.acceptEntries === true');
    expect(source).not.toContain('fecha: data.fecha, acceptEntries: true');
  });
});
