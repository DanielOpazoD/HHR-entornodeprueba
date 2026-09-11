import { vi } from 'vitest';
import '../../../extension/offscreen-contract.js';
import '../../../extension/offscreen-coordinator.js';

export type Message = {
  target: string;
  version: number;
  action: string;
  requestId: string;
  documentId?: string;
  channel?: string;
  payload?: unknown;
  timeoutMs?: number;
};
export type Context = { contextId: string; documentUrl: string };
export type Coordinator = {
  request: (
    channel: string,
    payload: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ) => Promise<unknown>;
  ensure: () => Promise<unknown>;
  close: (options?: { force?: boolean }) => Promise<void>;
  getDiagnostics: () => Record<string, number | boolean>;
};
export const deferred = <T = unknown>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
export const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
export function fixture(existing = false) {
  const url = 'chrome-extension://test/syslab-offscreen.html';
  let contexts: Context[] = existing ? [{ contextId: 'context-1', documentUrl: url }] : [];
  let documentId = 'document-1';
  let sequence = 0;
  const requests: Array<{ message: Message; result: ReturnType<typeof deferred> }> = [];
  const reply = (message: Message, result: unknown = message.payload) => ({
    version: 1,
    requestId: message.requestId,
    documentId: message.documentId || documentId,
    ok: true,
    result,
  });
  const chrome = {
    runtime: {
      getURL: vi.fn((file: string) => `chrome-extension://test/${file}`),
      getContexts: vi.fn(async () => contexts),
      sendMessage: vi.fn((message: Message): Promise<unknown> => {
        if (message.action === 'probe') return Promise.resolve(reply(message, { ready: true }));
        if (message.action === 'cancel') return Promise.resolve(undefined);
        const result = deferred();
        requests.push({ message, result });
        return result.promise;
      }),
    },
    offscreen: {
      createDocument: vi.fn(async () => {
        contexts = [{ contextId: 'context-1', documentUrl: url }];
      }),
      closeDocument: vi.fn(async () => {
        contexts = [];
      }),
    },
  };
  const create = () =>
    (
      globalThis as unknown as {
        HhrOffscreenCoordinator: { create: (options: Record<string, unknown>) => Coordinator };
      }
    ).HhrOffscreenCoordinator.create({ chrome, randomUUID: () => `request-${++sequence}` });
  return {
    chrome,
    requests,
    reply,
    create,
    coordinator: create(),
    replace: (id: string) => {
      documentId = id;
      contexts = [{ contextId: id, documentUrl: url }];
    },
    setContexts: (value: Context[]) => {
      contexts = value;
    },
  };
}
