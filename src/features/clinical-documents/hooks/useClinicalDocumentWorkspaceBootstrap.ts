import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';
import { listActiveClinicalDocumentTemplates } from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';
import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { hydrateClinicalDocumentRecord } from '@/domain/clinical-documents/compatibility';
import { subscribeClinicalDocumentsByEpisodeKeys } from '@/application/clinical-documents/clinicalDocumentUseCases';
import {
  resolveNextSelectedClinicalDocumentId,
  resolveSelectedClinicalTemplateId,
  filterClinicalDocumentsForCurrentEpisode,
} from './clinicalDocumentWorkspaceBootstrapSupport';

const EMPTY_DOCUMENTS: ClinicalDocumentRecord[] = [];

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
  readStatus: 'loading' | 'ready' | 'error';
  retryDocuments: () => void;
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
    status: ClinicalDocumentWorkspaceBootstrapState['readStatus'];
  }>({ episodeKey: '', documents: [], status: 'loading' });
  const [readAttempt, setReadAttempt] = useState(0);
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

  const readKey = JSON.stringify([hospitalId, episode.episodeKey]);
  const currentRead = canRead && documentsState.episodeKey === readKey;
  const documents = currentRead ? documentsState.documents : EMPTY_DOCUMENTS;
  const readStatus = currentRead ? documentsState.status : 'loading';
  const retryDocuments = () => {
    setDocumentsState(previous => ({ ...previous, status: 'loading' }));
    setReadAttempt(previous => previous + 1);
  };
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

    let active = true;
    const unsubscribe = subscribeClinicalDocumentsByEpisodeKeys(
      episodeKeys,
      (docs, confirmed = true) => {
        if (!active) return;
        const hydrated = docs.map(hydrateClinicalDocumentRecord);
        const currentEpisodeDocuments = filterClinicalDocumentsForCurrentEpisode({
          documents: hydrated,
          currentEpisodeKey: episode.episodeKey,
          allowedEpisodeKeys: episodeKeys,
          currentPatientRut: patient.rut,
        });
        if (!confirmed && currentEpisodeDocuments.length === 0) {
          setDocumentsState(previous =>
            previous.episodeKey === readKey
              ? { ...previous, status: 'loading' }
              : { episodeKey: readKey, documents: EMPTY_DOCUMENTS, status: 'loading' }
          );
          return;
        }
        setDocumentsState({
          episodeKey: readKey,
          status: confirmed ? 'ready' : 'loading',
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
      hospitalId,
      {
        onError: error => {
          if (!active) return;
          const restricted =
            'code' in error &&
            (error.code === 'permission-denied' || error.code === 'unauthenticated');
          setDocumentsState(previous => ({
            episodeKey: readKey,
            status: 'error',
            documents: !restricted && previous.episodeKey === readKey ? previous.documents : [],
          }));
          if (restricted) setSelectedDocumentState({ episodeKey: episode.episodeKey, id: null });
        },
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    canRead,
    episode.episodeKey,
    episodeKeys,
    hospitalId,
    isActive,
    patient.rut,
    readAttempt,
    readKey,
  ]);

  return {
    templates,
    selectedTemplateId: resolvedSelectedTemplateId,
    setSelectedTemplateId,
    documents,
    readStatus,
    retryDocuments,
    selectedDocumentId,
    setSelectedDocumentId,
    episode,
  };
};
