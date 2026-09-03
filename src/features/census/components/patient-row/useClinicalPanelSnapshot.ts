import { useCallback, useEffect, useState } from 'react';
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
  return { phase: 'error', message: 'La extensión instalada aún no entrega documentos.' };
};

const panelStateFrom = (result: RayenClinicalPanelResult): PanelState =>
  result.error
    ? { phase: 'error', message: result.error }
    : { phase: 'ready', panel: parseClinicalPanel(result.events, result.carePlan) };

export const useClinicalPanelSnapshot = (clinicalEpisodeId: string) => {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const [documentState, setDocumentState] = useState<DocumentState>({ phase: 'loading' });

  const applyResult = useCallback((result: RayenClinicalPanelResult) => {
    setDocumentState(documentStateFrom(result));
    setState(panelStateFrom(result));
  }, []);

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    setDocumentState({ phase: 'loading' });
    void requestClinicalPanel(clinicalEpisodeId).then(applyResult);
  }, [applyResult, clinicalEpisodeId]);

  useEffect(() => {
    let active = true;
    void requestClinicalPanel(clinicalEpisodeId).then(result => {
      if (active) applyResult(result);
    });
    return () => {
      active = false;
    };
  }, [applyResult, clinicalEpisodeId]);

  return { state, documentState, reload };
};
