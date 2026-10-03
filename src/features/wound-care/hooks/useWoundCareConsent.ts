/**
 * Hook: Subscribe to wound care consent for an episode.
 *
 * Results belong to the current episode, hospital and subscription port.
 */

import { useState, useEffect, useMemo } from 'react';
import type { WoundCareConsent } from '@/types/domain/woundCare';
import {
  defaultWoundCareConsentPort,
  type WoundCareConsentPort,
} from '@/application/ports/woundCarePort';

interface UseWoundCareConsentOptions {
  episodeKey: string | undefined;
  hospitalId?: string;
  consentPort?: WoundCareConsentPort;
}

interface UseWoundCareConsentReturn {
  consent: WoundCareConsent | null;
  isLoading: boolean;
}

/**
 * Subscribe to the wound care consent for a hospitalization episode.
 *
 * Sets up a Firestore real-time listener via the consent port and
 * exposes the current consent (or `null`) along with a loading flag.
 * Automatically unsubscribes on unmount or when `episodeKey` changes.
 *
 * @param options.episodeKey  - Episode to subscribe to; no-op if undefined.
 * @param options.hospitalId  - Optional hospital override.
 * @param options.consentPort - Injectable port for testing.
 * @returns consent (nullable) and isLoading state.
 */
export const useWoundCareConsent = ({
  episodeKey,
  hospitalId,
  consentPort = defaultWoundCareConsentPort,
}: UseWoundCareConsentOptions): UseWoundCareConsentReturn => {
  const scope = useMemo(
    () => ({ episodeKey, hospitalId, consentPort }),
    [episodeKey, hospitalId, consentPort]
  );
  const [result, setResult] = useState<{
    scope: typeof scope;
    value: WoundCareConsent | null;
  } | null>(null);
  useEffect(() => {
    if (!scope.episodeKey) return;
    let active = true;
    const unsubscribe = scope.consentPort.subscribeByEpisode(
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
    consent: episodeKey && isCurrent ? result.value : null,
    isLoading: Boolean(episodeKey) && !isCurrent,
  };
};
