/**
 * Hook: Subscribe to wound care photos for an episode.
 *
 * Results belong to the current episode, hospital and subscription port.
 */

import { useState, useEffect, useMemo } from 'react';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import {
  defaultWoundCarePhotoPort,
  type WoundCarePhotoPort,
} from '@/application/ports/woundCarePort';

interface UseWoundCarePhotosOptions {
  episodeKey: string | undefined;
  hospitalId?: string;
  photoPort?: WoundCarePhotoPort;
}

interface UseWoundCarePhotosReturn {
  photos: WoundCarePhoto[];
  isLoading: boolean;
}

/**
 * Subscribe to wound care photos for a hospitalization episode.
 *
 * Sets up a Firestore real-time listener via the photo port and
 * exposes the current list of non-deleted photos along with a
 * loading flag. Automatically unsubscribes on unmount or when
 * `episodeKey` changes.
 *
 * @param options.episodeKey - Episode to subscribe to; no-op if undefined.
 * @param options.hospitalId - Optional hospital override.
 * @param options.photoPort  - Injectable port for testing.
 * @returns photos (array) and isLoading state.
 */
export const useWoundCarePhotos = ({
  episodeKey,
  hospitalId,
  photoPort = defaultWoundCarePhotoPort,
}: UseWoundCarePhotosOptions): UseWoundCarePhotosReturn => {
  const scope = useMemo(
    () => ({ episodeKey, hospitalId, photoPort }),
    [episodeKey, hospitalId, photoPort]
  );
  const [result, setResult] = useState<{ scope: typeof scope; value: WoundCarePhoto[] } | null>(
    null
  );
  useEffect(() => {
    if (!scope.episodeKey) return;
    let active = true;
    const unsubscribe = scope.photoPort.subscribeByEpisode(
      scope.episodeKey,
      value => {
        if (active) setResult({ scope, value });
      },
      scope.hospitalId
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scope]);
  const isCurrent = result?.scope === scope;
  return {
    photos: episodeKey && isCurrent ? result.value : [],
    isLoading: Boolean(episodeKey) && !isCurrent,
  };
};
