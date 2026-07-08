import { afterEach, describe, expect, it, vi } from 'vitest';

type MessageListener = (event: MessageEvent<unknown>) => void;

class SharedBroadcastChannel {
  private static channels = new Map<string, Set<SharedBroadcastChannel>>();
  private readonly listeners = new Set<MessageListener>();

  constructor(private readonly name: string) {
    const channels = SharedBroadcastChannel.channels.get(name) ?? new Set();
    channels.add(this);
    SharedBroadcastChannel.channels.set(name, channels);
  }

  postMessage(message: unknown): void {
    const peers = SharedBroadcastChannel.channels.get(this.name) ?? new Set();
    for (const peer of peers) {
      if (peer === this) continue;
      queueMicrotask(() => {
        for (const listener of peer.listeners) {
          listener({ data: message } as MessageEvent<unknown>);
        }
      });
    }
  }

  addEventListener(eventName: string, listener: MessageListener): void {
    if (eventName === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(eventName: string, listener: MessageListener): void {
    if (eventName === 'message') {
      this.listeners.delete(listener);
    }
  }

  close(): void {
    SharedBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }

  static reset(): void {
    SharedBroadcastChannel.channels.clear();
  }
}

const loadRecordEventsModuleForTab = async (tabId: string) => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => tabId) });
  vi.resetModules();
  return import('@/services/storage/indexeddb/indexedDbRecordEvents');
};

describe('indexedDbRecordEvents cross-tab delivery', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  afterEach(() => {
    SharedBroadcastChannel.reset();
    vi.resetModules();
    vi.unstubAllGlobals();
    globalThis.BroadcastChannel = originalBroadcastChannel;
  });

  it('re-emits another tab daily-record change through the local app event surface', async () => {
    globalThis.BroadcastChannel = SharedBroadcastChannel as unknown as typeof BroadcastChannel;

    const tabAEvents = await loadRecordEventsModuleForTab('tab-a');
    const received: unknown[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent).detail);
    };
    window.addEventListener(tabAEvents.DAILY_RECORD_STORE_CHANGED_EVENT, listener);

    const tabBEvents = await loadRecordEventsModuleForTab('tab-b');
    tabBEvents.dispatchDailyRecordStoreChanged({
      operation: 'save',
      dates: ['2026-05-24'],
    });
    await Promise.resolve();

    window.removeEventListener(tabAEvents.DAILY_RECORD_STORE_CHANGED_EVENT, listener);
    expect(received).toEqual([
      { operation: 'save', dates: ['2026-05-24'] },
      { operation: 'save', dates: ['2026-05-24'] },
    ]);
    expect(
      tabAEvents.isDailyRecordStoreChangeRelevantToRange(
        received[1] as { operation: 'save'; dates: string[] },
        '2026-05-01',
        '2026-05-31'
      )
    ).toBe(true);
  });
});
