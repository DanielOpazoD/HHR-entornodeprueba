/**
 * Batched wound-care photo count store and provider.
 *
 * Replaces per-row Firestore reads, 5-minute intervals, and `visibilitychange` listeners in the
 * handoff table with a single batched `countByEpisodeKeys` reader, one timer, and one visibility
 * listener. Consumers subscribe per-episode via `useSyncExternalStore`, so refreshing one bed
 * after closing its modal never re-renders sibling rows.
 */

import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { WoundCarePhotoRepository } from '@/features/wound-care/services/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

export const WOUND_CARE_PHOTO_POLL_INTERVAL_MS = 5 * 60_000;
export const WOUND_CARE_PHOTO_RETURN_REFRESH_AFTER_MS = 60_000;

export type ActivePhotoCountState =
  | { status: 'ready'; count: number }
  | { status: 'loading' | 'unavailable'; previousCount: number | null };

export type WoundCarePhotoCountState = { status: 'idle' } | ActivePhotoCountState;

export const IDLE_PHOTO_COUNT_STATE: WoundCarePhotoCountState = Object.freeze({ status: 'idle' });
export const INITIAL_LOADING_PHOTO_COUNT_STATE: ActivePhotoCountState = Object.freeze({
  status: 'loading',
  previousCount: null,
});

export const extractPreviousPhotoCount = (
  state: ActivePhotoCountState | undefined
): number | null => {
  if (!state) return null;
  return state.status === 'ready' ? state.count : state.previousCount;
};

const isSameActiveState = (
  current: ActivePhotoCountState | undefined,
  next: ActivePhotoCountState
): boolean => {
  if (!current || current.status !== next.status) return false;
  if (current.status === 'ready' && next.status === 'ready') {
    return current.count === next.count;
  }
  if (current.status !== 'ready' && next.status !== 'ready') {
    return current.previousCount === next.previousCount;
  }
  return false;
};

export interface WoundCarePhotoCountStore {
  subscribe: (episodeKey: string | undefined, listener: () => void) => () => void;
  getSnapshot: (episodeKey: string | undefined) => WoundCarePhotoCountState;
  refreshEpisode: (episodeKey: string) => void;
  hasReady: (episodeKey: string) => boolean;
  pruneToActiveKeys: (activeKeys: ReadonlySet<string>) => void;
  beginBatchRead: (episodeKeys: readonly string[]) => Map<string, number>;
  resolveBatchRead: (
    episodeKeys: readonly string[],
    counts: Record<string, number>,
    capturedVersions: ReadonlyMap<string, number>
  ) => void;
  failBatchRead: (
    episodeKeys: readonly string[],
    capturedVersions: ReadonlyMap<string, number>
  ) => void;
  dispose: () => void;
}

const createWoundCarePhotoCountStore = (): WoundCarePhotoCountStore => {
  const states = new Map<string, ActivePhotoCountState>();
  const versions = new Map<string, number>();
  const listenersByEpisode = new Map<string, Set<() => void>>();
  let disposed = false;

  const notifyEpisode = (episodeKey: string) => {
    const listeners = listenersByEpisode.get(episodeKey);
    if (!listeners) return;
    for (const listener of listeners) {
      listener();
    }
  };

  const setEpisodeState = (episodeKey: string, next: ActivePhotoCountState) => {
    if (isSameActiveState(states.get(episodeKey), next)) return;
    states.set(episodeKey, next);
    notifyEpisode(episodeKey);
  };

  const bumpVersion = (episodeKey: string): number => {
    const next = (versions.get(episodeKey) ?? 0) + 1;
    versions.set(episodeKey, next);
    return next;
  };

  return {
    subscribe(episodeKey, listener) {
      if (!episodeKey) return () => {};
      let listeners = listenersByEpisode.get(episodeKey);
      if (!listeners) {
        listeners = new Set();
        listenersByEpisode.set(episodeKey, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          listenersByEpisode.delete(episodeKey);
        }
      };
    },

    getSnapshot(episodeKey) {
      if (!episodeKey) return IDLE_PHOTO_COUNT_STATE;
      return states.get(episodeKey) ?? INITIAL_LOADING_PHOTO_COUNT_STATE;
    },

    hasReady(episodeKey) {
      return states.get(episodeKey)?.status === 'ready';
    },

    pruneToActiveKeys(activeKeys) {
      for (const key of Array.from(states.keys())) {
        if (!activeKeys.has(key)) {
          states.delete(key);
          versions.delete(key);
        }
      }
    },

    beginBatchRead(episodeKeys) {
      const capturedVersions = new Map<string, number>();
      for (const key of episodeKeys) {
        capturedVersions.set(key, bumpVersion(key));
        setEpisodeState(key, {
          status: 'loading',
          previousCount: extractPreviousPhotoCount(states.get(key)),
        });
      }
      return capturedVersions;
    },

    resolveBatchRead(episodeKeys, counts, capturedVersions) {
      if (disposed) return;
      for (const key of episodeKeys) {
        if (versions.get(key) !== capturedVersions.get(key)) continue;
        setEpisodeState(key, { status: 'ready', count: counts[key] ?? 0 });
      }
    },

    failBatchRead(episodeKeys, capturedVersions) {
      if (disposed) return;
      for (const key of episodeKeys) {
        if (versions.get(key) !== capturedVersions.get(key)) continue;
        setEpisodeState(key, {
          status: 'unavailable',
          previousCount: extractPreviousPhotoCount(states.get(key)),
        });
      }
    },

    refreshEpisode(episodeKey) {
      if (disposed || !episodeKey) return;
      const version = bumpVersion(episodeKey);
      setEpisodeState(episodeKey, {
        status: 'loading',
        previousCount: extractPreviousPhotoCount(states.get(episodeKey)),
      });
      WoundCarePhotoRepository.listByEpisode(episodeKey)
        .then(photos => {
          if (disposed || versions.get(episodeKey) !== version) return;
          setEpisodeState(episodeKey, { status: 'ready', count: photos.length });
        })
        .catch(error => {
          if (disposed || versions.get(episodeKey) !== version) return;
          setEpisodeState(episodeKey, {
            status: 'unavailable',
            previousCount: extractPreviousPhotoCount(states.get(episodeKey)),
          });
          logger.warn('Failed to refresh wound-care photo count', error);
        });
    },

    dispose() {
      disposed = true;
    },
  };
};

export const WoundCarePhotoCountContext = createContext<WoundCarePhotoCountStore | null>(null);

interface WoundCarePhotoCountProviderProps {
  episodeKeys: readonly string[];
  children?: React.ReactNode;
}

export const WoundCarePhotoCountProvider: React.FC<WoundCarePhotoCountProviderProps> = ({
  episodeKeys,
  children,
}) => {
  const [store] = useState<WoundCarePhotoCountStore>(() => createWoundCarePhotoCountStore());
  const lastReadAtRef = useRef<number | null>(null);

  const normalizedKey = useMemo(() => {
    const uniqueSorted = Array.from(
      new Set(episodeKeys.map(key => key.trim()).filter(Boolean))
    ).sort();
    return uniqueSorted.join('\0');
  }, [episodeKeys]);

  useEffect(() => () => store.dispose(), [store]);

  useEffect(() => {
    const activeKeys = normalizedKey ? normalizedKey.split('\0') : [];
    store.pruneToActiveKeys(new Set(activeKeys));
    if (activeKeys.length === 0) return;

    let cancelled = false;
    let pending = false;

    const fetchBatch = () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      lastReadAtRef.current = Date.now();
      const capturedVersions = store.beginBatchRead(activeKeys);

      WoundCarePhotoRepository.countByEpisodeKeys(activeKeys)
        .then(counts => {
          if (!cancelled) {
            store.resolveBatchRead(activeKeys, counts, capturedVersions);
          }
        })
        .catch(error => {
          if (!cancelled) {
            store.failBatchRead(activeKeys, capturedVersions);
            logger.warn('Failed to refresh wound-care photo counts', error);
          }
        })
        .finally(() => {
          pending = false;
        });
    };

    const refreshIfStale = () => {
      if (
        lastReadAtRef.current === null ||
        Date.now() - lastReadAtRef.current >= WOUND_CARE_PHOTO_RETURN_REFRESH_AFTER_MS
      ) {
        fetchBatch();
      }
    };

    if (activeKeys.some(key => !store.hasReady(key))) {
      fetchBatch();
    }

    const interval = setInterval(fetchBatch, WOUND_CARE_PHOTO_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [normalizedKey, store]);

  return (
    <WoundCarePhotoCountContext.Provider value={store}>
      {children}
    </WoundCarePhotoCountContext.Provider>
  );
};
