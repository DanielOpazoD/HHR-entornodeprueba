// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('extension/content-hhr-syslab.js'), 'utf8');

const runtimeTypes = {
  SYSLAB_STATUS_REQUEST: 'RAYEN_SYSLAB_STATUS_REQUEST',
  LAB_SEARCH_REQUEST: 'RAYEN_LAB_SEARCH_REQUEST',
  LAB_DETAILS_REQUEST: 'RAYEN_LAB_DETAILS_REQUEST',
  LAB_PDF_OPEN_REQUEST: 'RAYEN_LAB_PDF_OPEN_REQUEST',
};

const createHarness = (sendMessage = vi.fn(async () => ({ ok: true }))) => {
  let onMessage:
    | ((event: { source: unknown; data: Record<string, unknown> }) => void)
    | undefined;
  const postMessage = vi.fn();
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
    HhrRayenMessageContract: { types: runtimeTypes },
  });
  vm.runInContext(source, context, { filename: 'content-hhr-syslab.js' });
  return { onMessage, postMessage, sendMessage, windowObject };
};

describe('HHR Syslab content bridge', () => {
  it('installs only on trusted HHR origins', () => {
    const addEventListener = vi.fn();
    const context = vm.createContext({
      window: { location: { origin: 'http://localhost:4000' }, addEventListener },
      HhrRayenMessageContract: { types: runtimeTypes },
    });

    vm.runInContext(source, context, { filename: 'content-hhr-syslab.js' });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('forwards search by RUN without exposing a direct Syslab URL', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: [{ id: '43091284', link: 'hhr-syslab-extension://batch/id/exam/43091284' }],
    }));
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: {
        type: 'HHR_RAYEN_SYSLAB_SEARCH_REQUEST',
        reqId: 'syslab-search-1',
        encId: '141814',
      },
    });

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'RAYEN_LAB_SEARCH_REQUEST',
        encId: '141814',
      })
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'HHR_RAYEN_SYSLAB_SEARCH_RESULT',
        reqId: 'syslab-search-1',
        response: expect.objectContaining({ ok: true }),
      }),
      'http://localhost:3000'
    );
  });

  it('rejects oversized detail requests instead of silently truncating them', async () => {
    const { onMessage, sendMessage, windowObject } = createHarness();
    const batchId = '123e4567-e89b-12d3-a456-426614174000';
    const links = Array.from(
      { length: 30 },
      (_, index) => `hhr-syslab-extension://batch/${batchId}/exam/${43090000 + index}`
    );

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_SYSLAB_DETAILS_REQUEST', reqId: 'details-1', links },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_LAB_DETAILS_REQUEST',
      batchId: '',
      examIds: [],
    });
  });

  it('opens only an opaque report locator through the extension viewer', async () => {
    const { onMessage, sendMessage, windowObject } = createHarness();
    const batchId = '123e4567-e89b-12d3-a456-426614174000';

    onMessage?.({
      source: windowObject,
      data: {
        type: 'HHR_RAYEN_SYSLAB_PDF_REQUEST',
        reqId: 'pdf-1',
        link: `hhr-syslab-extension://batch/${batchId}/exam/43091284`,
      },
    });

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'RAYEN_LAB_PDF_OPEN_REQUEST',
        batchId,
        examId: '43091284',
      })
    );
  });

  it('turns an invalidated context into a calm reload instruction', async () => {
    const sendMessage = vi.fn(() => {
      throw new Error('Extension context invalidated.');
    });
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_SYSLAB_STATUS_REQUEST', reqId: 'status-1' },
    });

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'HHR_RAYEN_SYSLAB_STATUS_RESULT',
          reqId: 'status-1',
          error: 'La extensión se actualizó. Recarga HHR y vuelve a intentarlo.',
        },
        'http://localhost:3000'
      )
    );
  });
});
