import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';
import { listActiveClinicalDocumentTemplates } from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';
import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { hydrateClinicalDocumentWorkspaceRecord } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { subscribeClinicalDocumentsByEpisodeKeys } from '@/application/clinical-documents/clinicalDocumentUseCases';
import {
  resolveNextSelectedClinicalDocumentId,
  resolveSelectedClinicalTemplateId,
  filterClinicalDocumentsForCurrentEpisode,
} from './clinicalDocumentWorkspaceBootstrapSupport';

interface UseClinicalDocumentWorkspaceBootstrapParams {
  patient: ClinicalDocumentsWorkspacePatientContract;
  currentDateString: string;
  bedId: string;
  isActive: boolean;
  canRead: boolean;
  hospitalId: string;
  role: string;
}

export interface ClinicalDocumentWorkspaceBootstrapState {
  templates: ClinicalDocumentTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: React.Dispatch<React.SetStateAction<string>>;
  documents: ClinicalDocumentRecord[];
  selectedDocumentId: string | null;
  setSelectedDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  episode: ReturnType<typeof buildClinicalDocumentEpisodeContext>;
}

export const useClinicalDocumentWorkspaceBootstrap = ({
  patient,
  currentDateString,
  bedId,
  isActive,
  canRead,
  hospitalId,
}: UseClinicalDocumentWorkspaceBootstrapParams): ClinicalDocumentWorkspaceBootstrapState => {
  const templates = useMemo(() => listActiveClinicalDocumentTemplates(), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('epicrisis');
  const [documentsState, setDocumentsState] = useState<{
    episodeKey: string;
    documents: ClinicalDocumentRecord[];
  }>({ episodeKey: '', documents: [] });
  const [selectedDocumentState, setSelectedDocumentState] = useState<{
    episodeKey: string;
    id: string | null;
  }>({ episodeKey: '', id: null });

  const episode = useMemo(
    () => buildClinicalDocumentEpisodeContext(patient, currentDateString, bedId),
    [bedId, currentDateString, patient]
  );
  const episodeKeys = useMemo(
    () => Array.from(new Set([episode.episodeKey, ...(episode.documentLookupEpisodeKeys || [])])),
    [episode.documentLookupEpisodeKeys, episode.episodeKey]
  );

  const resolvedSelectedTemplateId = useMemo(() => {
    return resolveSelectedClinicalTemplateId(templates, selectedTemplateId);
  }, [selectedTemplateId, templates]);

  const documents =
    documentsState.episodeKey === episode.episodeKey ? documentsState.documents : [];
  const selectedDocumentId =
    selectedDocumentState.episodeKey === episode.episodeKey ? selectedDocumentState.id : null;

  const setSelectedDocumentId = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    value => {
      setSelectedDocumentState(previousState => {
        const previousId =
          previousState.episodeKey === episode.episodeKey ? previousState.id : null;
        const nextId = typeof value === 'function' ? value(previousId) : value;
        return { episodeKey: episode.episodeKey, id: nextId };
      });
    },
    [episode.episodeKey]
  );

  useEffect(() => {
    if (!isActive || !canRead) {
      return;
    }

    const unsubscribe = subscribeClinicalDocumentsByEpisodeKeys(
      episodeKeys,
      docs => {
        const hydrated = docs.map(document => hydrateClinicalDocumentWorkspaceRecord(document));
        const currentEpisodeDocuments = filterClinicalDocumentsForCurrentEpisode({
          documents: hydrated,
          currentEpisodeKey: episode.episodeKey,
          allowedEpisodeKeys: episodeKeys,
          currentPatientRut: patient.rut,
        });
        setDocumentsState({
          episodeKey: episode.episodeKey,
          documents: currentEpisodeDocuments,
        });
        setSelectedDocumentState(previousState => {
          const previousId =
            previousState.episodeKey === episode.episodeKey ? previousState.id : null;
          return {
            episodeKey: episode.episodeKey,
            id: resolveNextSelectedClinicalDocumentId(currentEpisodeDocuments, previousId),
          };
        });
      },
      hospitalId
    );

    return () => {
      unsubscribe();
    };
  }, [canRead, episode.episodeKey, episodeKeys, hospitalId, isActive, patient.rut]);

  return {
    templates,
    selectedTemplateId: resolvedSelectedTemplateId,
    setSelectedTemplateId,
    documents,
    selectedDocumentId,
    setSelectedDocumentId,
    episode,
  };
};
