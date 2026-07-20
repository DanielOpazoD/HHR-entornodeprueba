// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('extension/content-hhr-epicrisis.js'), 'utf8');

describe('HHR epicrisis content bridge', () => {
  it('does not install the authenticated bridge on unrelated localhost origins', () => {
    const addEventListener = vi.fn();
    const context = vm.createContext({
      window: {
        location: { origin: 'http://localhost:4000' },
        addEventListener,
        postMessage: vi.fn(),
      },
      chrome: { runtime: { sendMessage: vi.fn() } },
      HhrRayenMessageContract: {
        types: {
          NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST: 'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
        },
      },
    });

    vm.runInContext(source, context, { filename: 'content-hhr-epicrisis.js' });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('forwards only the download contract and returns the operational result', async () => {
    let onMessage:
      | ((event: { source: unknown; data: Record<string, unknown> }) => void)
      | undefined;
    const postMessage = vi.fn();
    const sendMessage = vi.fn(async () => ({
      ok: true,
      episodes: [{ encId: '141336', startDate: '2026-07-18', endDate: '', active: true }],
    }));
    const windowObject = {
      location: { origin: 'http://localhost:3000' },
      addEventListener: vi.fn((type: string, listener: typeof onMessage) => {
        if (type === 'message') onMessage = listener;
      }),
      postMessage,
    };
    const context = vm.createContext({
      window: windowObject,
      chrome: { runtime: { sendMessage } },
      console: { warn: vi.fn() },
      HhrRayenMessageContract: {
        types: {
          NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST: 'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
        },
      },
    });
    vm.runInContext(source, context, { filename: 'content-hhr-epicrisis.js' });

    onMessage?.({
      source: windowObject,
      data: {
        type: 'HHR_RAYEN_EPICRISIS_DOWNLOAD_REQUEST',
        reqId: 'request-1',
        encId: '141336',
        patientRun: '177527531',
        censusDate: '2026-07-19',
        operation: 'list',
      },
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
      encId: '141336',
      patientRun: '177527531',
      censusDate: '2026-07-19',
      delivery: 'download',
      operation: 'list',
      documentType: undefined,
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'HHR_RAYEN_EPICRISIS_DOWNLOAD_RESULT',
          reqId: 'request-1',
          ok: true,
          episodes: [{ encId: '141336', startDate: '2026-07-18', endDate: '', active: true }],
          opened: false,
          error: undefined,
        },
        'http://localhost:3000'
      )
    );

  });
});
