/**
 * Hook: Lightweight check if a patient episode has wound care photos.
 *
 * Inside `WoundCarePhotoCountProvider` (used by `HandoffPatientTable`), this subscribes
 * granularly to the shared batched store with zero per-row timers or listeners, and triggers a
 * targeted single-episode read only when `refreshToken` increments (e.g., modal close).
 * Outside a provider, it falls back to standalone per-episode polling.
 */

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WoundCarePhotoRepository } from '@/features/wound-care/services/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';
import {
  IDLE_PHOTO_COUNT_STATE,
  WOUND_CARE_PHOTO_POLL_INTERVAL_MS,
  WOUND_CARE_PHOTO_RETURN_REFRESH_AFTER_MS,
  WoundCarePhotoCountContext,
  type ActivePhotoCountState,
  type WoundCarePhotoCountState,
} from './WoundCarePhotoCountContext';

export type { WoundCarePhotoCountState };

const NOOP_UNSUBSCRIBE = () => {};
const GET_IDLE_STATE = () => IDLE_PHOTO_COUNT_STATE;

export const useWoundCarePhotoCount = (
  episodeKey: string | undefined,
  refreshToken = 0
): WoundCarePhotoCountState => {
  const batchStore = useContext(WoundCarePhotoCountContext);

  const subscribeBatched = useCallback(
    (listener: () => void) =>
      batchStore ? batchStore.subscribe(episodeKey, listener) : NOOP_UNSUBSCRIBE,
    [batchStore, episodeKey]
  );

  const getBatchedSnapshot = useCallback(
    () => (batchStore ? batchStore.getSnapshot(episodeKey) : IDLE_PHOTO_COUNT_STATE),
    [batchStore, episodeKey]
  );

  const batchedState = useSyncExternalStore(subscribeBatched, getBatchedSnapshot, GET_IDLE_STATE);

  const lastRefreshRef = useRef<{ episodeKey: string | undefined; token: number }>({
    episodeKey,
    token: refreshToken,
  });

  useEffect(() => {
    const previous = lastRefreshRef.current;
    lastRefreshRef.current = { episodeKey, token: refreshToken };
    if (
      batchStore &&
      episodeKey &&
      previous.episodeKey === episodeKey &&
      previous.token !== refreshToken
    ) {
      batchStore.refreshEpisode(episodeKey);
    }
  }, [batchStore, episodeKey, refreshToken]);

  const [result, setResult] = useState<{
    episodeKey: string;
    state: ActivePhotoCountState;
  } | null>(null);

  useEffect(() => {
    if (batchStore || !episodeKey) return;

    let cancelled = false;
    let pending = false;
    let lastReadAt: number | null = null;

    const previousCount = (previous: typeof result) => {
      if (previous?.episodeKey !== episodeKey) return null;
      return previous.state.status === 'ready'
        ? previous.state.count
        : previous.state.previousCount;
    };

    const fetch = () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      lastReadAt = Date.now();
      setResult(previous => ({
        episodeKey,
        state: { status: 'loading', previousCount: previousCount(previous) },
      }));
      WoundCarePhotoRepository.listByEpisode(episodeKey)
        .then(photos => {
          if (!cancelled)
            setResult({ episodeKey, state: { status: 'ready', count: photos.length } });
        })
        .catch(error => {
          if (!cancelled) {
            setResult(previous => ({
              episodeKey,
              state: { status: 'unavailable', previousCount: previousCount(previous) },
            }));
            logger.warn('Failed to refresh wound-care photo count', error);
          }
        })
        .finally(() => {
          pending = false;
        });
    };

    const refreshIfStale = () => {
      if (
        lastReadAt === null ||
        Date.now() - lastReadAt >= WOUND_CARE_PHOTO_RETURN_REFRESH_AFTER_MS
      ) {
        fetch();
      }
    };

    fetch();

    // Hidden tabs skip the poll and catch up on return when the count is stale.
    const interval = setInterval(fetch, WOUND_CARE_PHOTO_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [batchStore, episodeKey, refreshToken]);

  if (batchStore) return batchedState;
  if (!episodeKey) return IDLE_PHOTO_COUNT_STATE;
  return result?.episodeKey === episodeKey
    ? result.state
    : { status: 'loading', previousCount: null };
};
