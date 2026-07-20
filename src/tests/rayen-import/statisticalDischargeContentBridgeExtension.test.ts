// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('extension/content-hhr-statistical-discharge.js'), 'utf8');

describe('HHR statistical-discharge content bridge', () => {
  it('only installs on trusted HHR origins', () => {
    const addEventListener = vi.fn();
    const context = vm.createContext({
      window: { location: { origin: 'http://localhost:4000' }, addEventListener },
      HhrRayenMessageContract: { types: { STATISTICAL_DISCHARGE_REPORT_REQUEST: 'REQUEST' } },
    });

    vm.runInContext(source, context, { filename: 'content-hhr-statistical-discharge.js' });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('forwards the exact episode and returns the operational result', async () => {
    let onMessage: ((event: { source: unknown; data: Record<string, unknown> }) => void) | undefined;
    const postMessage = vi.fn();
    const sendMessage = vi.fn(async () => ({ ok: true }));
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
        types: { STATISTICAL_DISCHARGE_REPORT_REQUEST: 'RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST' },
      },
    });
    vm.runInContext(source, context, { filename: 'content-hhr-statistical-discharge.js' });

    onMessage?.({
      source: windowObject,
      data: {
        type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_REQUEST',
        reqId: 'egreso-1',
        encId: '141704',
      },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST',
      encId: '141704',
    }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_RESULT',
      reqId: 'egreso-1',
      ok: true,
      error: undefined,
    }, 'http://localhost:3000');
  });
});
