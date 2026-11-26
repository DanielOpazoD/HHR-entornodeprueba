/**
 * Hook: Load wound care photo history across all hospitalizations for a patient.
 *
 * Fetches all photos and consents by `patientRut`, then groups them by
 * `episodeKey` so the UI can render current and previous episodes in
 * collapsible sections. The current episode always sorts first.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import {
  defaultWoundCarePhotoPort,
  defaultWoundCareConsentPort,
  type WoundCarePhotoPort,
  type WoundCareConsentPort,
} from '@/features/wound-care/use-cases/woundCarePort';
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
  applyPhotoDescription: (photoId: string, description: string) => void;
  applyDeletedPhoto: (photoId: string) => void;
  applyUploadedPhoto: (photo: WoundCarePhoto) => void;
  applyUploadedConsent: (consent: WoundCareConsent) => void;
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
  const [loadKey, setLoadKey] = useState(0);
  // Monotonic generation bumped synchronously on reload() and accredited local updates so an
  // already-in-flight fetch settling in a microtask before React commits cannot overwrite newer writes.
  const fetchGenerationRef = useRef(0);
  const [result, setResult] = useState<{
    scope: typeof scope;
    loadKey: number;
    photos: WoundCarePhoto[];
    consents: WoundCareConsent[];
  } | null>(null);
  const allPhotos = result?.scope === scope ? result.photos : [];
  const allConsents = result?.scope === scope ? result.consents : [];
  // Keep loaded episodes mounted during background reloads so active modals/editors are preserved.
  const isLoading = Boolean(patientRut) && result?.scope !== scope;

  const reload = useCallback(() => {
    fetchGenerationRef.current += 1;
    setLoadKey(k => k + 1);
  }, []);

  const applyPhotoDescription = useCallback(
    (photoId: string, description: string) => {
      fetchGenerationRef.current += 1;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        return {
          ...previous,
          photos: previous.photos.map(photo =>
            photo.id === photoId ? { ...photo, description } : photo
          ),
        };
      });
    },
    [scope]
  );

  const applyDeletedPhoto = useCallback(
    (photoId: string) => {
      fetchGenerationRef.current += 1;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        return {
          ...previous,
          photos: previous.photos.filter(photo => photo.id !== photoId),
        };
      });
    },
    [scope]
  );

  const applyUploadedPhoto = useCallback(
    (photo: WoundCarePhoto) => {
      fetchGenerationRef.current += 1;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        const remaining = previous.photos.filter(existing => existing.id !== photo.id);
        return {
          ...previous,
          photos: [photo, ...remaining],
        };
      });
    },
    [scope]
  );

  const applyUploadedConsent = useCallback(
    (consent: WoundCareConsent) => {
      fetchGenerationRef.current += 1;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        const remaining = previous.consents.filter(existing => existing.id !== consent.id);
        return {
          ...previous,
          consents: [consent, ...remaining],
        };
      });
    },
    [scope]
  );

  useEffect(() => {
    if (!scope.patientRut) return;

    let cancelled = false;
    const generation = ++fetchGenerationRef.current;

    Promise.all([
      scope.photoPort.listByPatientRut(scope.patientRut),
      scope.consentPort.listByPatientRut(scope.patientRut),
    ])
      .then(([photos, consents]) => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        setResult({ scope, loadKey, photos, consents });
      })
      .catch(error => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        woundCareHistoryLogger.error('Error loading wound care history', error);
        setResult(previous => ({
          scope,
          loadKey,
          photos: previous?.scope === scope ? previous.photos : [],
          consents: previous?.scope === scope ? previous.consents : [],
        }));
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
      if (!byEpisode.has(consent.episodeKey)) {
        byEpisode.set(consent.episodeKey, []);
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
        // Current episode first, then by most recent photo or consent
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        const aDate = a.photos[0]?.uploadedAt ?? a.consent?.uploadedAt ?? '';
        const bDate = b.photos[0]?.uploadedAt ?? b.consent?.uploadedAt ?? '';
        return bDate.localeCompare(aDate);
      });
  })();

  return {
    episodes,
    allPhotos,
    allConsents,
    isLoading,
    reload,
    applyPhotoDescription,
    applyDeletedPhoto,
    applyUploadedPhoto,
    applyUploadedConsent,
  };
};
