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
  isRefreshing: boolean;
  photosError: string | null;
  consentsError: string | null;
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
const invokePortRead = <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return Promise.resolve(read());
  } catch (error) {
    return Promise.reject(error);
  }
};

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
  const loadKeyRef = useRef(0);
  // Monotonic generation bumped synchronously on reload() and accredited local updates so an
  // already-in-flight fetch settling in a microtask before React commits cannot overwrite newer writes.
  const fetchGenerationRef = useRef(0);
  const [result, setResult] = useState<{
    scope: typeof scope;
    photosLoadKey: number | null;
    consentsLoadKey: number | null;
    photos: WoundCarePhoto[];
    consents: WoundCareConsent[];
    photosError: string | null;
    consentsError: string | null;
  } | null>(null);
  const scopedResult = result?.scope === scope ? result : null;
  const allPhotos = scopedResult?.photos ?? [];
  const allConsents = scopedResult?.consents ?? [];
  const photosError = scopedResult?.photosError ?? null;
  const consentsError = scopedResult?.consentsError ?? null;
  // Initial load waits for both branches so the first paint has a complete baseline;
  // subsequent reloads keep loaded episodes mounted and publish each branch as soon as it settles.
  const isLoading =
    Boolean(patientRut) &&
    (scopedResult === null ||
      scopedResult.photosLoadKey === null ||
      scopedResult.consentsLoadKey === null);
  const isRefreshing =
    Boolean(patientRut) &&
    scopedResult !== null &&
    scopedResult.photosLoadKey !== null &&
    scopedResult.consentsLoadKey !== null &&
    (scopedResult.photosLoadKey !== loadKey || scopedResult.consentsLoadKey !== loadKey);

  const reload = useCallback(() => {
    fetchGenerationRef.current += 1;
    setLoadKey(k => k + 1);
  }, []);

  useEffect(() => {
    loadKeyRef.current = loadKey;
  }, [loadKey]);

  const applyPhotoDescription = useCallback(
    (photoId: string, description: string) => {
      fetchGenerationRef.current += 1;
      const settledLoadKey = loadKeyRef.current;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        return {
          ...previous,
          photosLoadKey: previous.photosLoadKey === null ? null : settledLoadKey,
          consentsLoadKey: previous.consentsLoadKey === null ? null : settledLoadKey,
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
      const settledLoadKey = loadKeyRef.current;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        return {
          ...previous,
          photosLoadKey: previous.photosLoadKey === null ? null : settledLoadKey,
          consentsLoadKey: previous.consentsLoadKey === null ? null : settledLoadKey,
          photos: previous.photos.filter(photo => photo.id !== photoId),
        };
      });
    },
    [scope]
  );

  const applyUploadedPhoto = useCallback(
    (photo: WoundCarePhoto) => {
      fetchGenerationRef.current += 1;
      const settledLoadKey = loadKeyRef.current;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        const remaining = previous.photos.filter(existing => existing.id !== photo.id);
        return {
          ...previous,
          photosLoadKey: previous.photosLoadKey === null ? null : settledLoadKey,
          consentsLoadKey: previous.consentsLoadKey === null ? null : settledLoadKey,
          photos: [photo, ...remaining],
        };
      });
    },
    [scope]
  );

  const applyUploadedConsent = useCallback(
    (consent: WoundCareConsent) => {
      fetchGenerationRef.current += 1;
      const settledLoadKey = loadKeyRef.current;
      setResult(previous => {
        if (!previous || previous.scope !== scope) return previous;
        const remaining = previous.consents.filter(existing => existing.id !== consent.id);
        return {
          ...previous,
          photosLoadKey: previous.photosLoadKey === null ? null : settledLoadKey,
          consentsLoadKey: previous.consentsLoadKey === null ? null : settledLoadKey,
          consents: [consent, ...remaining],
        };
      });
    },
    [scope]
  );

  useEffect(() => {
    const activePatientRut = scope.patientRut;
    if (!activePatientRut) return;

    let cancelled = false;
    const generation = ++fetchGenerationRef.current;

    const photosPromise = invokePortRead(() => scope.photoPort.listByPatientRut(activePatientRut));
    const consentsPromise = invokePortRead(() =>
      scope.consentPort.listByPatientRut(activePatientRut)
    );

    void photosPromise.then(
      photos => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        setResult(previous => {
          const sameScope = previous?.scope === scope;
          return {
            scope,
            photosLoadKey: loadKey,
            consentsLoadKey: sameScope ? previous.consentsLoadKey : null,
            photos,
            consents: sameScope ? previous.consents : [],
            photosError: null,
            consentsError: sameScope ? previous.consentsError : null,
          };
        });
      },
      reason => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        woundCareHistoryLogger.error('Error loading wound care history', reason);
        setResult(previous => {
          const sameScope = previous?.scope === scope;
          return {
            scope,
            photosLoadKey: loadKey,
            consentsLoadKey: sameScope ? previous.consentsLoadKey : null,
            photos: sameScope ? previous.photos : [],
            consents: sameScope ? previous.consents : [],
            photosError:
              'No fue posible cargar las fotografías. Reintente para verificar el historial.',
            consentsError: sameScope ? previous.consentsError : null,
          };
        });
      }
    );

    void consentsPromise.then(
      consents => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        setResult(previous => {
          const sameScope = previous?.scope === scope;
          return {
            scope,
            photosLoadKey: sameScope ? previous.photosLoadKey : null,
            consentsLoadKey: loadKey,
            photos: sameScope ? previous.photos : [],
            consents,
            photosError: sameScope ? previous.photosError : null,
            consentsError: null,
          };
        });
      },
      reason => {
        if (cancelled || fetchGenerationRef.current !== generation) return;
        woundCareHistoryLogger.error('Error loading wound care history', reason);
        setResult(previous => {
          const sameScope = previous?.scope === scope;
          return {
            scope,
            photosLoadKey: sameScope ? previous.photosLoadKey : null,
            consentsLoadKey: loadKey,
            photos: sameScope ? previous.photos : [],
            consents: sameScope ? previous.consents : [],
            photosError: sameScope ? previous.photosError : null,
            consentsError:
              'No fue posible verificar el consentimiento informado. Reintente para confirmar su estado.',
          };
        });
      }
    );

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
    isRefreshing,
    photosError,
    consentsError,
    reload,
    applyPhotoDescription,
    applyDeletedPhoto,
    applyUploadedPhoto,
    applyUploadedConsent,
  };
};
