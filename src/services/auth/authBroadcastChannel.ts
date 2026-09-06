/**
 * Cross-tab authentication coordination via BroadcastChannel.
 *
 * Enables propagation of auth events (logout, sync completion) between
 * browser tabs of the same origin. Each tab has a unique ID to avoid
 * processing its own messages.
 *
 * Gracefully degrades: if BroadcastChannel is unavailable (e.g., Safari <15.4),
 * all functions are no-ops and no errors are thrown.
 */

const CHANNEL_NAME = 'hhr_auth_channel';

export type AuthChannelMessage =
  | { type: 'ACTIVITY'; userId: string; at: number; tabId: string }
  | { type: 'LOGOUT'; reason: 'manual' | 'automatic'; tabId: string }
  | { type: 'SYNC_COMPLETED'; taskTypes: string[]; tabId: string };

const TAB_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}`;

export function broadcastSessionActivity(userId: string, at: number): void {
  try {
    getChannel()?.postMessage({
      type: 'ACTIVITY',
      userId,
      at,
      tabId: TAB_ID,
    } satisfies AuthChannelMessage);
  } catch {
    // Shared storage still coordinates activity if the channel is unavailable.
  }
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return channel;
}

/** Notify other tabs that this tab has logged out. */
export function broadcastLogout(reason: 'manual' | 'automatic'): void {
  getChannel()?.postMessage({
    type: 'LOGOUT',
    reason,
    tabId: TAB_ID,
  } satisfies AuthChannelMessage);
}

/** Notify other tabs that sync tasks completed (for cache invalidation). */
export function broadcastSyncCompleted(taskTypes: string[]): void {
  getChannel()?.postMessage({
    type: 'SYNC_COMPLETED',
    taskTypes,
    tabId: TAB_ID,
  } satisfies AuthChannelMessage);
}

/**
 * Subscribe to auth-related messages from other tabs.
 * Messages from this tab are automatically filtered out.
 * @returns Cleanup function to unsubscribe.
 */
export function onAuthChannelMessage(callback: (message: AuthChannelMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};

  const handler = (event: MessageEvent<AuthChannelMessage>) => {
    // Ignore messages sent by this tab
    if (event.data?.tabId === TAB_ID) return;
    callback(event.data);
  };

  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
