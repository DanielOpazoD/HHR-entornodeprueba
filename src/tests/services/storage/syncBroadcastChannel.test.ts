import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastDailyRecordStoreChanged,
  onSyncBroadcastMessage,
  resetSyncBroadcastChannelForTests,
  type SyncBroadcastMessage,
} from '@/services/storage/sync/syncBroadcastChannel';

describe('syncBroadcastChannel', () => {
  let originalBroadcastChannel: typeof globalThis.BroadcastChannel;

  beforeEach(() => {
    originalBroadcastChannel = globalThis.BroadcastChannel;
    resetSyncBroadcastChannelForTests();
  });

  afterEach(() => {
    resetSyncBroadcastChannelForTests();
    globalThis.BroadcastChannel = originalBroadcastChannel;
    vi.restoreAllMocks();
  });

  it('does not throw when BroadcastChannel is unavailable', () => {
    // @ts-expect-error - simulating browsers without BroadcastChannel
    delete globalThis.BroadcastChannel;

    expect(() =>
      broadcastDailyRecordStoreChanged({ operation: 'save', dates: ['2026-05-24'] })
    ).not.toThrow();
    const cleanup = onSyncBroadcastMessage(() => {});
    expect(cleanup).toBeTypeOf('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('broadcasts daily record store changes with tab identity', () => {
    const postMessage = vi.fn();
    globalThis.BroadcastChannel = vi.fn(function () {
      return {
        postMessage,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
      };
    }) as unknown as typeof BroadcastChannel;

    broadcastDailyRecordStoreChanged({ operation: 'save', dates: ['2026-05-24'] });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DAILY_RECORD_STORE_CHANGED',
        detail: { operation: 'save', dates: ['2026-05-24'] },
        tabId: expect.any(String),
      })
    );
  });

  it('subscribes and filters messages from the current tab', () => {
    let handler: ((event: MessageEvent<SyncBroadcastMessage>) => void) | undefined;
    const addEventListener = vi.fn((_eventName, nextHandler) => {
      handler = nextHandler as typeof handler;
    });
    const removeEventListener = vi.fn();
    const postMessage = vi.fn((message: SyncBroadcastMessage) => {
      handler?.({ data: message } as MessageEvent<SyncBroadcastMessage>);
    });
    globalThis.BroadcastChannel = vi.fn(function () {
      return {
        postMessage,
        addEventListener,
        removeEventListener,
        close: vi.fn(),
      };
    }) as unknown as typeof BroadcastChannel;

    const callback = vi.fn();
    const cleanup = onSyncBroadcastMessage(callback);
    broadcastDailyRecordStoreChanged({ operation: 'delete', dates: ['2026-05-24'] });
    handler?.({
      data: {
        type: 'DAILY_RECORD_STORE_CHANGED',
        detail: { operation: 'clear' },
        tabId: 'other-tab',
      },
    } as MessageEvent<SyncBroadcastMessage>);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { operation: 'clear' },
        tabId: 'other-tab',
      })
    );

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('ignores malformed cross-tab payloads before notifying subscribers', () => {
    let handler: ((event: MessageEvent<unknown>) => void) | undefined;
    const addEventListener = vi.fn((_eventName, nextHandler) => {
      handler = nextHandler as typeof handler;
    });
    globalThis.BroadcastChannel = vi.fn(function () {
      return {
        postMessage: vi.fn(),
        addEventListener,
        removeEventListener: vi.fn(),
        close: vi.fn(),
      };
    }) as unknown as typeof BroadcastChannel;

    const callback = vi.fn();
    onSyncBroadcastMessage(callback);
    handler?.({
      data: {
        type: 'DAILY_RECORD_STORE_CHANGED',
        detail: { operation: 'save', dates: [42] },
        tabId: 'other-tab',
      },
    } as MessageEvent<unknown>);
    handler?.({
      data: {
        type: 'DAILY_RECORD_STORE_CHANGED',
        detail: { operation: 'unexpected', dates: ['2026-05-24'] },
        tabId: 'other-tab',
      },
    } as MessageEvent<unknown>);
    handler?.({
      data: {
        type: 'DAILY_RECORD_STORE_CHANGED',
        detail: { operation: 'save', dates: ['2026-05-24'] },
        tabId: 'other-tab',
      },
    } as MessageEvent<unknown>);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { operation: 'save', dates: ['2026-05-24'] },
      })
    );
  });
});
