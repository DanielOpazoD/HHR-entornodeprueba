import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseClinicalPanel,
  requestClinicalPanel,
  type ClinicalPanel,
  type RayenClinicalPanelResult,
  type RayenPatientDocument,
} from '@/features/rayen-import';

export type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; panel: ClinicalPanel };

export type DocumentState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; documents: RayenPatientDocument[] };

const documentStateFrom = (result: RayenClinicalPanelResult): DocumentState => {
  if (result.documentError) return { phase: 'error', message: result.documentError };
  if (result.documents) return { phase: 'ready', documents: result.documents };
  return {
    phase: 'error',
    message: 'La extensión instalada es anterior al Gestor documental. Recárgala en Chrome.',
  };
};

const panelStateFrom = (result: RayenClinicalPanelResult): PanelState =>
  result.error
    ? { phase: 'error', message: result.error }
    : { phase: 'ready', panel: parseClinicalPanel(result.events, result.carePlan) };

export const useClinicalPanelSnapshot = (clinicalEpisodeId: string) => {
  const [snapshot, setSnapshot] = useState<{
    episode: string;
    state: PanelState;
    documentState: DocumentState;
  }>({
    episode: clinicalEpisodeId,
    state: { phase: 'loading' },
    documentState: { phase: 'loading' },
  });
  const pending = useRef<{ episode: string; controller: AbortController } | null>(null);

  const load = useCallback(() => {
    // Repeated clicks share the active read instead of launching overlapping snapshots.
    if (pending.current?.episode === clinicalEpisodeId) return false;
    pending.current?.controller.abort();
    const request = { episode: clinicalEpisodeId, controller: new AbortController() };
    pending.current = request;
    void requestClinicalPanel(clinicalEpisodeId, undefined, request.controller.signal)
      .then(result => {
        if (pending.current !== request || request.controller.signal.aborted) return;
        setSnapshot({
          episode: clinicalEpisodeId,
          state: panelStateFrom(result),
          documentState: documentStateFrom(result),
        });
      })
      .catch(() => {
        if (pending.current !== request || request.controller.signal.aborted) return;
        const error = {
          phase: 'error' as const,
          message: 'No se pudo cargar el panel clínico. Vuelve a intentar.',
        };
        setSnapshot({ episode: clinicalEpisodeId, state: error, documentState: error });
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
    return true;
  }, [clinicalEpisodeId]);

  const reload = useCallback(() => {
    if (load()) {
      setSnapshot({
        episode: clinicalEpisodeId,
        state: { phase: 'loading' },
        documentState: { phase: 'loading' },
      });
    }
  }, [clinicalEpisodeId, load]);

  useEffect(() => {
    load();
    return () => {
      pending.current?.controller.abort();
      pending.current = null;
    };
  }, [load]);

  // Never expose the previous patient's text during the render before effect cleanup.
  const sameEpisode = snapshot.episode === clinicalEpisodeId;
  return {
    state: sameEpisode ? snapshot.state : { phase: 'loading' as const },
    documentState: sameEpisode ? snapshot.documentState : { phase: 'loading' as const },
    reload,
  };
};
