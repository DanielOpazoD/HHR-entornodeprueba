/**
 * Hook: Load wound care photo history across all hospitalizations for a patient.
 *
 * Fetches all photos and consents by `patientRut`, then groups them by
 * `episodeKey` so the UI can render current and previous episodes in
 * collapsible sections. The current episode always sorts first.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import {
  defaultWoundCarePhotoPort,
  defaultWoundCareConsentPort,
  type WoundCarePhotoPort,
  type WoundCareConsentPort,
} from '@/application/ports/woundCarePort';
import { createScopedLogger } from '@/services/utils/loggerScope';

/**
 * A group of wound care photos and their associated consent for a single
 * hospitalization episode. Used by the history view to render per-episode
 * collapsible sections.
 */
export interface EpisodePhotoGroup {
  /** Composite key identifying the hospitalization episode. */
  episodeKey: string;
  /** Photos for this episode, sorted by upload date descending. */
  photos: WoundCarePhoto[];
  /** The consent record for this episode, if any (prefers signed). */
  consent: WoundCareConsent | undefined;
  /** Whether this is the patient's current (active) hospitalization. */
  isCurrent: boolean;
}

interface UseWoundCareHistoryOptions {
  patientRut: string | undefined;
  currentEpisodeKey: string | undefined;
  photoPort?: WoundCarePhotoPort;
  consentPort?: WoundCareConsentPort;
}

interface UseWoundCareHistoryReturn {
  episodes: EpisodePhotoGroup[];
  allPhotos: WoundCarePhoto[];
  allConsents: WoundCareConsent[];
  isLoading: boolean;
  reload: () => void;
}

const woundCareHistoryLogger = createScopedLogger('WoundCareHistory');

/**
 * Load wound care photo and consent history across all hospitalizations
 * for a given patient.
 *
 * Performs a one-shot fetch of all photos and consents by `patientRut`,
 * groups them into {@link EpisodePhotoGroup} entries (current episode first,
 * then sorted by most recent photo), and exposes a `reload()` function
 * to re-fetch after mutations.
 *
 * @param options.patientRut        - Chilean RUT of the patient; skips fetch if undefined.
 * @param options.currentEpisodeKey - Episode key of the active hospitalization.
 * @param options.photoPort         - Injectable port for testing.
 * @param options.consentPort       - Injectable port for testing.
 * @returns episodes, allPhotos, allConsents, isLoading, reload.
 */
export const useWoundCareHistory = ({
  patientRut,
  currentEpisodeKey,
  photoPort = defaultWoundCarePhotoPort,
  consentPort = defaultWoundCareConsentPort,
}: UseWoundCareHistoryOptions): UseWoundCareHistoryReturn => {
  const scope = useMemo(
    () => ({ patientRut, photoPort, consentPort }),
    [patientRut, photoPort, consentPort]
  );
  const [result, setResult] = useState<{
    scope: typeof scope;
    photos: WoundCarePhoto[];
    consents: WoundCareConsent[];
    isLoading: boolean;
  } | null>(null);
  const allPhotos = result?.scope === scope ? result.photos : [];
  const allConsents = result?.scope === scope ? result.consents : [];
  const isLoading = Boolean(patientRut) && (result?.scope !== scope || result.isLoading);
  const [loadKey, setLoadKey] = useState(0);

  const reload = useCallback(() => setLoadKey(k => k + 1), []);

  useEffect(() => {
    if (!scope.patientRut) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset loading for new fetch
    setResult(previous => ({
      scope,
      photos: previous?.scope === scope ? previous.photos : [],
      consents: previous?.scope === scope ? previous.consents : [],
      isLoading: true,
    }));

    Promise.all([
      scope.photoPort.listByPatientRut(scope.patientRut),
      scope.consentPort.listByPatientRut(scope.patientRut),
    ])
      .then(([photos, consents]) => {
        if (cancelled) return;
        setResult({ scope, photos, consents, isLoading: false });
      })
      .catch(error => {
        if (cancelled) return;
        woundCareHistoryLogger.error('Error loading wound care history', error);
        setResult(previous =>
          previous?.scope === scope ? { ...previous, isLoading: false } : previous
        );
      });

    return () => {
      cancelled = true;
    };
  }, [scope, loadKey]);

  // Group by episode
  const episodes: EpisodePhotoGroup[] = (() => {
    if (!patientRut) return [];

    const byEpisode = new Map<string, WoundCarePhoto[]>();
    for (const photo of allPhotos) {
      const existing = byEpisode.get(photo.episodeKey) ?? [];
      existing.push(photo);
      byEpisode.set(photo.episodeKey, existing);
    }

    const consentByEpisode = new Map<string, WoundCareConsent>();
    for (const consent of allConsents) {
      const existing = consentByEpisode.get(consent.episodeKey);
      if (!existing || consent.status === 'signed') {
        consentByEpisode.set(consent.episodeKey, consent);
      }
    }

    // If current episode has no photos yet, still show it
    if (currentEpisodeKey && !byEpisode.has(currentEpisodeKey)) {
      byEpisode.set(currentEpisodeKey, []);
    }

    return Array.from(byEpisode.entries())
      .map(([episodeKey, photos]) => ({
        episodeKey,
        photos: photos.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
        consent: consentByEpisode.get(episodeKey),
        isCurrent: episodeKey === currentEpisodeKey,
      }))
      .sort((a, b) => {
        // Current episode first, then by most recent photo
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        const aDate = a.photos[0]?.uploadedAt ?? '';
        const bDate = b.photos[0]?.uploadedAt ?? '';
        return bDate.localeCompare(aDate);
      });
  })();

  return { episodes, allPhotos, allConsents, isLoading, reload };
};
