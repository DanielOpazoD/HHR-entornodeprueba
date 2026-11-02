// @vitest-environment node
import { readHhrBridgeSource } from './support/hhrOriginPolicyFixture';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readHhrBridgeSource('content-hhr-audit-documents.js');
const TYPES = {
  AUDIT_DOCUMENTS_REQUEST: 'RAYEN_AUDIT_DOCUMENTS_REQUEST',
  AUDIT_DOCUMENTS_CANCEL: 'RAYEN_AUDIT_DOCUMENTS_CANCEL',
  AUDIT_DOCUMENTS_PROGRESS: 'RAYEN_AUDIT_DOCUMENTS_PROGRESS',
  AUDIT_DOCUMENTS_FILE_CHUNK: 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK',
};

type PageListener = (event: { source: unknown; origin: string; data: unknown }) => void;
type RuntimeListener = (
  message: unknown,
  sender?: unknown,
  sendResponse?: (response: unknown) => void
) => unknown;

const install = (
  origin: string,
  sendMessage = vi.fn(async (_message: unknown) => ({})),
  onMessageOverrides: { removeListener?: (listener: unknown) => void } = {}
) => {
  let onPageMessage: PageListener | undefined;
  let onRuntimeMessage: RuntimeListener | undefined;
  const postMessage = vi.fn();
  const saved: Array<{ blob: Blob; filename: string }> = [];
  let pendingBlob: Blob | null = null;
  const link = {
    href: '',
    download: '',
    style: {} as Record<string, string>,
    click: vi.fn(() => {
      if (pendingBlob) saved.push({ blob: pendingBlob, filename: link.download });
    }),
    remove: vi.fn(),
  };
  const windowObject = {
    location: { origin },
    removeEventListener: () => undefined,
    addEventListener: vi.fn((type: string, listener: PageListener) => {
      if (type === 'message') onPageMessage = listener;
    }),
    postMessage,
  };
  const context = vm.createContext({
    window: windowObject,
    chrome: {
      runtime: {
        id: 'current-extension',
        sendMessage,
        onMessage: {
          removeListener: onMessageOverrides.removeListener ?? (() => undefined),
          addListener: (listener: RuntimeListener) => {
            onRuntimeMessage = listener;
          },
        },
      },
    },
    console: { warn: vi.fn() },
    HhrRayenMessageContract: { types: TYPES },
    Blob,
    atob,
    setTimeout: () => 0,
    Uint8Array,
    URL: {
      createObjectURL: (blob: Blob) => {
        pendingBlob = blob;
        return 'blob:synthetic';
      },
      revokeObjectURL: vi.fn(),
    },
    document: { createElement: () => link, documentElement: { appendChild: vi.fn() } },
  });
  vm.runInContext(source, context, { filename: 'content-hhr-audit-documents.js' });
  const fromPage = (data: unknown) =>
    onPageMessage?.({ source: windowObject, origin: windowObject.location.origin, data });
  return {
    fromPage,
    onRuntimeMessage: () => onRuntimeMessage,
    postMessage,
    sendMessage,
    windowObject,
    saved,
  };
};

describe('HHR audit documents content bridge', () => {
  it('is not installed on unrelated origins', () => {
    const bridge = install('http://localhost:4000');

    expect(bridge.windowObject.addEventListener).not.toHaveBeenCalled();
    expect(bridge.onRuntimeMessage()).toBeUndefined();
  });

  it('acknowledges at once, forwards the list and returns the counts to HHR', async () => {
    const sendMessage = vi.fn(async (_message: unknown) => ({
      ok: true,
      filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
      documentCount: 4,
      failedCount: 0,
      summary: [{ run: '111111111', hospitalizations: 2, downloaded: 4, failed: 0 }],
    }));
    const bridge = install('https://testinghhr.netlify.app', sendMessage);

    bridge.fromPage({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_REQUEST',
      reqId: 'audit-1',
      patients: [{ run: '111111111', dateFrom: '2026-07-01' }],
      documentTypes: ['history'],
    });

    expect(bridge.postMessage).toHaveBeenCalledWith(
      {
        type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
        reqId: 'audit-1',
        phase: 'accepted',
        done: 0,
        total: 0,
      },
      'https://testinghhr.netlify.app'
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_AUDIT_DOCUMENTS_REQUEST',
      requestId: 'audit-1',
      patients: [{ run: '111111111', dateFrom: '2026-07-01' }],
      documentTypes: ['history'],
    });
    await vi.waitFor(() =>
      expect(bridge.postMessage).toHaveBeenLastCalledWith(
        {
          type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT',
          reqId: 'audit-1',
          ok: true,
          filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
          documentCount: 4,
          failedCount: 0,
          summary: [{ run: '111111111', hospitalizations: 2, downloaded: 4, failed: 0 }],
          error: undefined,
        },
        'https://testinghhr.netlify.app'
      )
    );
  });

  it('relays progress and cancellation, and tells the screen when the worker stopped', async () => {
    const sendMessage = vi.fn(async (_message: unknown) => ({
      cancelled: true,
      error: 'cancelada',
    }));
    const bridge = install('http://localhost:3001', sendMessage);

    bridge.onRuntimeMessage()?.({
      type: 'RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      requestId: 'audit-2',
      phase: 'downloading',
      done: 3,
      total: 8,
    });
    bridge.fromPage({ type: 'HHR_RAYEN_AUDIT_DOCUMENTS_CANCEL', reqId: 'audit-2' });
    bridge.fromPage({
      type: 'HHR_RAYEN_AUDIT_DOCUMENTS_REQUEST',
      reqId: 'audit-2',
      patients: [],
      documentTypes: [],
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(bridge.postMessage).toHaveBeenCalledWith(
      {
        type: 'HHR_RAYEN_AUDIT_DOCUMENTS_PROGRESS',
        reqId: 'audit-2',
        phase: 'downloading',
        done: 3,
        total: 8,
      },
      'http://localhost:3001'
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_AUDIT_DOCUMENTS_CANCEL',
      requestId: 'audit-2',
    });
    await vi.waitFor(() =>
      expect(bridge.postMessage).toHaveBeenLastCalledWith(
        {
          type: 'HHR_RAYEN_AUDIT_DOCUMENTS_RESULT',
          reqId: 'audit-2',
          ok: false,
          cancelled: true,
          error: 'cancelada',
        },
        'http://localhost:3001'
      )
    );
  });

  it('installs on the first injection although Chrome rejects removing a missing listener', () => {
    const bridge = install('https://testinghhr.netlify.app', undefined, {
      removeListener: (listener: unknown) => {
        if (listener === undefined) throw new TypeError('No matching signature.');
      },
    });

    expect(bridge.onRuntimeMessage()).toEqual(expect.any(Function));
    expect(bridge.windowObject.addEventListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    );
  });

  it('drops the parts of a ZIP the worker discarded after a cancel', () => {
    const bridge = install('https://testinghhr.netlify.app');
    const send = (message: Record<string, unknown>) => {
      const replies: unknown[] = [];
      bridge.onRuntimeMessage()?.(
        { type: 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK', requestId: 'audit-5', ...message },
        {},
        reply => replies.push(reply)
      );
      return replies[0];
    };

    send({ index: 0, total: 2, filename: 'Auditoria.zip', base64: 'AA==' });
    expect(send({ discard: true })).toEqual({ ok: true });
    expect(send({ index: 1, total: 2, filename: 'Auditoria.zip', base64: 'AA==' })).toEqual({
      error: 'Las partes del ZIP llegaron desordenadas.',
    });
    expect(bridge.saved).toEqual([]);
  });

  it('joins the ZIP parts in order and saves the file in this tab', async () => {
    const bridge = install('https://testinghhr.netlify.app');
    const chunk = (index: number, text: string) => {
      const replies: unknown[] = [];
      bridge.onRuntimeMessage()?.(
        {
          type: 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK',
          requestId: 'audit-3',
          index,
          total: 2,
          filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
          base64: Buffer.from(text).toString('base64'),
        },
        {},
        reply => replies.push(reply)
      );
      return replies[0];
    };

    expect(chunk(0, 'PK-first-')).toEqual({ ok: true });
    expect(bridge.saved).toEqual([]);
    expect(chunk(1, 'second')).toEqual({ ok: true, saved: true });

    expect(bridge.saved).toHaveLength(1);
    expect(bridge.saved[0].filename).toBe('Auditoria_Eloisa_2026-11-02_1610.zip');
    expect(await bridge.saved[0].blob.text()).toBe('PK-first-second');
  });

  it('refuses a ZIP part that arrives out of order', () => {
    const bridge = install('https://testinghhr.netlify.app');
    const replies: unknown[] = [];

    bridge.onRuntimeMessage()?.(
      {
        type: 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK',
        requestId: 'audit-4',
        index: 1,
        total: 2,
        filename: 'Auditoria.zip',
        base64: 'AA==',
      },
      {},
      reply => replies.push(reply)
    );

    expect(replies).toEqual([{ error: 'Las partes del ZIP llegaron desordenadas.' }]);
    expect(bridge.saved).toEqual([]);
  });
});
