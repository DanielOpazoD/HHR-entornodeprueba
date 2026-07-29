import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_DEVICE_REPORT_REQUEST_TYPE,
  RAYEN_DEVICE_REPORT_RESULT_TYPE,
  requestDeviceReport,
} from '@/features/rayen-import/bridge/rayenImportBridge';

describe('device evidence capability negotiation', () => {
  afterEach(() => vi.restoreAllMocks());

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
