import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/entities';
import { listActiveClinicalDocumentTemplates } from '@/features/clinical-documents/controllers/clinicalDocumentTemplateController';
import { buildClinicalDocumentEpisodeContext } from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { hydrateClinicalDocumentWorkspaceRecord } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import {
  executeListActiveClinicalDocumentTemplates,
  executeSeedClinicalDocumentTemplates,
} from '@/application/clinical-documents/clinicalDocumentTemplateUseCases';
import { subscribeClinicalDocumentsByEpisodeKeys } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { clinicalDocumentObservability } from '@/features/clinical-documents/services/clinicalDocumentOperationalTelemetry';
import {
  resolveNextSelectedClinicalDocumentId,
  resolveSelectedClinicalTemplateId,
  filterClinicalDocumentsForCurrentEpisode,
  shouldSeedClinicalDocumentTemplates,
} from './clinicalDocumentWorkspaceBootstrapSupport';

interface UseClinicalDocumentWorkspaceBootstrapParams {
  patient: PatientData;
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
  role,
}: UseClinicalDocumentWorkspaceBootstrapParams): ClinicalDocumentWorkspaceBootstrapState => {
  const [templates, setTemplates] = useState<ClinicalDocumentTemplate[]>(
    listActiveClinicalDocumentTemplates()
  );
  const [remoteTemplateCount, setRemoteTemplateCount] = useState<number | null>(null);
  const [hasLoadedRemoteTemplates, setHasLoadedRemoteTemplates] = useState(false);
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

    let cancelled = false;

    const loadTemplates = async () => {
      const remoteTemplatesOutcome = await executeListActiveClinicalDocumentTemplates(hospitalId);
      clinicalDocumentObservability.recordOutcome(
        'list_clinical_document_templates',
        remoteTemplatesOutcome,
        {
          date: currentDateString,
          context: { hospitalId },
        }
      );
      const remoteTemplates = remoteTemplatesOutcome.data;
      if (!cancelled) {
        setTemplates(remoteTemplates);
        setRemoteTemplateCount(remoteTemplates.length);
        setHasLoadedRemoteTemplates(true);
      }
    };

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [canRead, currentDateString, hospitalId, isActive]);

  useEffect(() => {
    if (
      !shouldSeedClinicalDocumentTemplates({
        isActive,
        role,
        hasLoadedRemoteTemplates,
        remoteTemplateCount,
      })
    ) {
      return;
    }

    void executeSeedClinicalDocumentTemplates(hospitalId).then(outcome => {
      clinicalDocumentObservability.recordOutcome('seed_clinical_document_templates', outcome, {
        date: currentDateString,
        context: { hospitalId },
        allowSuccess: true,
      });
      if (outcome.status === 'failed') {
        setTemplates(listActiveClinicalDocumentTemplates());
        return;
      }
      setTemplates(outcome.data);
    });
  }, [
    currentDateString,
    hasLoadedRemoteTemplates,
    hospitalId,
    isActive,
    remoteTemplateCount,
    role,
  ]);

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
