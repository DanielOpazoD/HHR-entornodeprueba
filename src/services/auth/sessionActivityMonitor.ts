import { ACTIVITY_EVENTS, SESSION_TIMEOUT_MS } from '@/constants/security';
import { broadcastSessionActivity, onAuthChannelMessage } from './authBroadcastChannel';

const PUBLISH_INTERVAL_MS = 15_000;

/** One timer per tab; the expiry decision always rereads activity shared by the same user. */
export const startSessionActivityMonitor = (
  userId: string,
  onExpired: () => void,
  target: Window = window
): (() => void) => {
  const key = `hhr_auth_activity:${userId}`;
  let lastActivity = Date.now();
  let lastPublished = 0;
  let lastPublishedActivity = 0;
  let stopped = false;
  let awaitingChannel = false;
  let expiryTimer: ReturnType<typeof setTimeout>;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  const accept = (at: number) => {
    if (Number.isFinite(at) && at > 0 && at <= Date.now()) {
      lastActivity = Math.max(lastActivity, at);
    }
  };
  const readSharedActivity = () => {
    try {
      accept(Number(target.localStorage.getItem(key)));
    } catch {
      /* Channel/local fallback. */
    }
  };
  const publish = () => {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    if (stopped) return;
    readSharedActivity();
    // Visibility changes without new activity must not delay the next real input.
    if (lastActivity === lastPublishedActivity) return;
    try {
      target.localStorage.setItem(key, String(lastActivity));
    } catch {
      /* Channel/local fallback. */
    }
    broadcastSessionActivity(userId, lastActivity);
    lastPublished = Date.now();
    lastPublishedActivity = lastActivity;
  };
  const checkExpiry = (allowChannelGrace = true) => {
    if (stopped || awaitingChannel) return;
    clearTimeout(expiryTimer);
    // A suspended tab can run its timeout before queued channel/storage events.
    lastActivity = Math.min(lastActivity, Date.now());
    readSharedActivity();
    const remaining = SESSION_TIMEOUT_MS - (Date.now() - lastActivity);
    if (remaining <= 0) {
      if (allowChannelGrace) {
        // Give queued channel messages one bounded opportunity after a suspended tab wakes.
        awaitingChannel = true;
        expiryTimer = setTimeout(() => {
          awaitingChannel = false;
          checkExpiry(false);
        }, 1000);
        return;
      }
      stopped = true;
      clearTimeout(publishTimer);
      onExpired();
    } else {
      expiryTimer = setTimeout(() => checkExpiry(), remaining);
    }
  };
  const onActivity = () => {
    if (stopped) return;
    lastActivity = Date.now();
    if (Date.now() - lastPublished >= PUBLISH_INTERVAL_MS) {
      clearTimeout(publishTimer);
      publish();
    } else if (publishTimer === undefined) {
      // Trailing publication preserves the final event without one message per mousemove.
      publishTimer = setTimeout(publish, PUBLISH_INTERVAL_MS - (Date.now() - lastPublished));
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) readSharedActivity();
  };
  const onVisible = () => {
    if (target.document.visibilityState === 'visible') checkExpiry();
    else publish();
  };
  const unsubscribe = onAuthChannelMessage(message => {
    if (!stopped && message.type === 'ACTIVITY' && message.userId === userId) accept(message.at);
  });
  ACTIVITY_EVENTS.forEach(event => target.addEventListener(event, onActivity, { passive: true }));
  target.addEventListener('storage', onStorage);
  target.addEventListener('pagehide', publish);
  target.document.addEventListener('visibilitychange', onVisible);
  // Entering an authenticated tab retains the existing initial inactivity grace period.
  publish();
  checkExpiry();
  return () => {
    stopped = true;
    clearTimeout(expiryTimer);
    clearTimeout(publishTimer);
    unsubscribe();
    ACTIVITY_EVENTS.forEach(event => target.removeEventListener(event, onActivity));
    target.removeEventListener('storage', onStorage);
    target.removeEventListener('pagehide', publish);
    target.document.removeEventListener('visibilitychange', onVisible);
  };
};
