// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChannelMessage } from '@/services/auth/authBroadcastChannel';

type ChannelModule = typeof import('@/services/auth/authBroadcastChannel');
type MessageHandler = (event: MessageEvent<AuthChannelMessage>) => void;

describe('authBroadcastChannel', () => {
  let api: ChannelModule;
  let originalDescriptor: PropertyDescriptor | undefined;
  let listeners: Set<MessageHandler>;
  let channel: {
    postMessage: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  let constructor: ReturnType<typeof vi.fn>;

  const deliver = (message: AuthChannelMessage) => {
    for (const handler of listeners) {
      handler({ data: message } as MessageEvent<AuthChannelMessage>);
    }
  };

  beforeEach(async () => {
    vi.resetModules();
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
    listeners = new Set();
    channel = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((_type: string, handler: MessageHandler) => listeners.add(handler)),
      removeEventListener: vi.fn((_type: string, handler: MessageHandler) =>
        listeners.delete(handler)
      ),
    };
    constructor = vi.fn(function () {
      return channel;
    });
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: constructor,
    });
    api = await import('@/services/auth/authBroadcastChannel');
  });

  afterEach(() => {
    listeners.clear();
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'BroadcastChannel', originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    }
    vi.restoreAllMocks();
  });

  it('does not throw when BroadcastChannel is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');

    expect(() => api.broadcastLogout('manual')).not.toThrow();
    expect(() => api.broadcastSyncCompleted(['daily:2026-04-05'])).not.toThrow();
    expect(() => api.broadcastSessionActivity('synthetic-user', 123)).not.toThrow();
    expect(constructor).not.toHaveBeenCalled();
  });

  it('returns no-op cleanup when BroadcastChannel is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    const callback = vi.fn();

    expect(() => api.onAuthChannelMessage(callback)()).not.toThrow();
    expect(channel.addEventListener).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('degrades without opening a channel when its constructor fails', () => {
    constructor.mockImplementation(function () {
      throw new Error('Channel unavailable');
    });

    expect(() => api.broadcastLogout('automatic')).not.toThrow();
    expect(() => api.broadcastSyncCompleted(['staff:catalog'])).not.toThrow();
    expect(() => api.onAuthChannelMessage(vi.fn())()).not.toThrow();
    expect(channel.postMessage).not.toHaveBeenCalled();
    expect(channel.addEventListener).not.toHaveBeenCalled();
  });

  it.each(['manual', 'automatic'] as const)(
    'broadcasts %s logout with the admitted generation',
    async reason => {
      const { setSessionGeneration } = await import('@/services/storage/sessionStorageTransition');
      setSessionGeneration('synthetic-generation');

      api.broadcastLogout(reason);

      expect(channel.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'LOGOUT',
        reason,
        generation: 'synthetic-generation',
        tabId: expect.any(String),
      });
      expect(constructor).toHaveBeenCalledExactlyOnceWith('hhr_auth_channel');
    }
  );

  it('includes task types and activity values while reusing the same channel', () => {
    const taskTypes = ['daily:2026-04-05', 'staff:catalog'];
    api.broadcastSyncCompleted(taskTypes);
    api.broadcastSessionActivity('synthetic-user', 123);

    const tabId = channel.postMessage.mock.calls[0][0].tabId;
    expect(tabId).toEqual(expect.any(String));
    expect(channel.postMessage.mock.calls).toEqual([
      [{ type: 'SYNC_COMPLETED', taskTypes, tabId }],
      [{ type: 'ACTIVITY', userId: 'synthetic-user', at: 123, tabId }],
    ]);
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('ignores delivered messages from this tab and forwards foreign messages', () => {
    const callback = vi.fn();
    const cleanup = api.onAuthChannelMessage(callback);
    api.broadcastLogout('manual');
    const localMessage = channel.postMessage.mock.calls[0][0] as AuthChannelMessage;

    deliver(localMessage);
    expect(callback).not.toHaveBeenCalled();

    const foreignMessage = { ...localMessage, tabId: `${localMessage.tabId}-foreign` };
    deliver(foreignMessage);
    expect(callback).toHaveBeenCalledExactlyOnceWith(foreignMessage);
    cleanup();
  });

  it('removes only its own listener and stops delivery after cleanup', () => {
    const first = vi.fn();
    const second = vi.fn();
    const cleanupFirst = api.onAuthChannelMessage(first);
    const cleanupSecond = api.onAuthChannelMessage(second);
    const firstHandler = channel.addEventListener.mock.calls[0][1];
    const message: AuthChannelMessage = {
      type: 'SYNC_COMPLETED',
      taskTypes: ['staff:catalog'],
      tabId: 'foreign-tab',
    };

    deliver(message);
    cleanupFirst();
    expect(channel.removeEventListener).toHaveBeenCalledExactlyOnceWith('message', firstHandler);
    expect(listeners.size).toBe(1);
    deliver(message);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    cleanupSecond();
    expect(listeners.size).toBe(0);
  });
});
