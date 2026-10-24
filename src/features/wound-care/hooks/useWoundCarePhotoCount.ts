/**
 * Hook: Lightweight check if a patient episode has wound care photos.
 * Polls the active episode without overlapping reads.
 *
 * Every handoff row runs its own read, and each read lists all photos of the episode, so the
 * badge refreshes every 5 minutes instead of every 30 s. Returning to the tab refreshes a count
 * older than a minute, and the caller bumps `refreshToken` when the wound-care modal closes.
 */

import { useState, useEffect } from 'react';
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

const POLL_INTERVAL_MS = 5 * 60_000;
const RETURN_REFRESH_AFTER_MS = 60_000;

type ActivePhotoCountState =
  | { status: 'ready'; count: number }
  | { status: 'loading' | 'unavailable'; previousCount: number | null };

export type WoundCarePhotoCountState = { status: 'idle' } | ActivePhotoCountState;

export const useWoundCarePhotoCount = (
  episodeKey: string | undefined,
  refreshToken = 0
): WoundCarePhotoCountState => {
  const [result, setResult] = useState<{
    episodeKey: string;
    state: ActivePhotoCountState;
  } | null>(null);

  useEffect(() => {
    if (!episodeKey) return;

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
      if (lastReadAt === null || Date.now() - lastReadAt >= RETURN_REFRESH_AFTER_MS) fetch();
    };

    fetch();

    // Hidden tabs skip the poll and catch up on return when the count is stale.
    const interval = setInterval(fetch, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [episodeKey, refreshToken]);

  if (!episodeKey) return { status: 'idle' };
  return result?.episodeKey === episodeKey
    ? result.state
    : { status: 'loading', previousCount: null };
};
