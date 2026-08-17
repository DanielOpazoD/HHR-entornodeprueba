import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_CUDYR_CATEGORIES_REQUEST_TYPE,
  RAYEN_CUDYR_CATEGORIES_RESULT_TYPE,
  requestCudyrCategories,
} from '@/features/rayen-import/bridge/rayenImportBridge';

const contentBridgeSource = readFileSync(path.resolve('extension/content-hhr.js'), 'utf8');

describe('CUDYR evidence contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves official-history provenance from the page bridge', async () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(message => {
      const request = message as { reqId: string };
      if ((message as { type?: string }).type !== RAYEN_CUDYR_CATEGORIES_REQUEST_TYPE) return;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: window.location.origin,
            data: {
              type: RAYEN_CUDYR_CATEGORIES_RESULT_TYPE,
              reqId: request.reqId,
              items: [],
              source: 'gestion_camas',
              historyAvailable: true,
              warning: 'metadatos opcionales incompletos',
            },
          })
        );
      });
    });

    await expect(requestCudyrCategories(100)).resolves.toEqual({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
      warning: 'metadatos opcionales incompletos',
      error: undefined,
    });
  });

  it('forwards authority metadata from the extension worker into HHR', async () => {
    let onMessage:
      | ((event: { source: unknown; data: Record<string, unknown> }) => void)
      | undefined;
    const postMessage = vi.fn();
    const sendMessage = vi.fn(async () => ({
      items: [],
      source: 'ficha_medico',
      historyAvailable: false,
      warning: 'Gestión de Camas no disponible.',
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
      console,
      HhrRayenMessageContract: {
        types: { CUDYR_CATEGORIES_REQUEST: 'RAYEN_CUDYR_CATEGORIES_REQUEST' },
      },
    });
    vm.runInContext(contentBridgeSource, context, { filename: 'content-hhr.js' });

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_CUDYR_CATEGORIES_REQUEST', reqId: 'cudyr-contract-1' },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'HHR_RAYEN_CUDYR_CATEGORIES_RESULT',
        reqId: 'cudyr-contract-1',
        items: [],
        source: 'ficha_medico',
        historyAvailable: false,
        warning: 'Gestión de Camas no disponible.',
        error: undefined,
      },
      'http://localhost:3000'
    );
  });
});
