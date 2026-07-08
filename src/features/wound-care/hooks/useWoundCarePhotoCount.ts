/**
 * Hook: Lightweight check if a patient episode has wound care photos.
 * Returns just the count — no subscription, single fetch with cache.
 */

import { useState, useEffect } from 'react';
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';
import { logger } from '@/services/utils/loggerService';

/**
 * Lightweight check for whether a patient episode has wound care photos.
 * Returns the count and a refresh function.
 */
export const useWoundCarePhotoCount = (episodeKey: string | undefined): number => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!episodeKey) return;

    let cancelled = false;

    const fetch = () => {
      WoundCarePhotoRepository.listByEpisode(episodeKey)
        .then(photos => {
          if (!cancelled) setCount(photos.length);
        })
        .catch(error => {
          if (!cancelled) logger.warn('Failed to refresh wound-care photo count', error);
        });
    };

    fetch();

    // Re-check every 30 seconds while mounted (lightweight polling for badge freshness)
    const interval = setInterval(fetch, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [episodeKey]);

  return count;
};
