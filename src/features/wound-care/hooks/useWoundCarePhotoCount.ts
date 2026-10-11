/**
 * Hook: Lightweight check if a patient episode has wound care photos.
 * Polls the active episode without overlapping reads.
 */

import { useState, useEffect } from 'react';
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

/**
 * Lightweight check for whether a patient episode has wound care photos.
 * Returns zero until a count for the selected episode is available.
 */
export const useWoundCarePhotoCount = (episodeKey: string | undefined): number => {
  const [result, setResult] = useState<{ episodeKey: string; count: number } | null>(null);

  useEffect(() => {
    if (!episodeKey) return;

    let cancelled = false;
    let pending = false;

    const fetch = () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      WoundCarePhotoRepository.listByEpisode(episodeKey)
        .then(photos => {
          if (!cancelled) setResult({ episodeKey, count: photos.length });
        })
        .catch(error => {
          if (!cancelled) logger.warn('Failed to refresh wound-care photo count', error);
        })
        .finally(() => {
          pending = false;
        });
    };

    fetch();

    // Keep visible badges fresh; hidden tabs resume immediately on return.
    const interval = setInterval(fetch, 30_000);
    document.addEventListener('visibilitychange', fetch);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', fetch);
    };
  }, [episodeKey]);

  return result && result.episodeKey === episodeKey ? result.count : 0;
};
