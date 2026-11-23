import { useCallback, useMemo, useState } from 'react';
import {
  buildPatientRowUiStateVisibility,
  resolvePatientRowModalCloseState,
  type PatientRowModalKind,
} from '@/features/census/controllers/patientRowUiStateController';

export interface PatientRowUiState {
  showDemographics: boolean;
  showClinicalDocuments: boolean;
  showExamRequest: boolean;
  showImagingRequest: boolean;
  showHistory: boolean;
  openDemographics: () => void;
  closeDemographics: () => void;
  openClinicalDocuments: () => void;
  closeClinicalDocuments: () => void;
  openExamRequest: () => void;
  closeExamRequest: () => void;
  openImagingRequest: () => void;
  closeImagingRequest: () => void;
  openHistory: () => void;
  closeHistory: () => void;
}

export const usePatientRowUiState = (): PatientRowUiState => {
  const [activeModal, setActiveModal] = useState<PatientRowModalKind>(null);

  const openModal = useCallback((modal: Exclude<PatientRowModalKind, null>) => {
    setActiveModal(modal);
  }, []);

  const closeModal = useCallback((modal: Exclude<PatientRowModalKind, null>) => {
    setActiveModal(current => resolvePatientRowModalCloseState(current, modal));
  }, []);

  const visibility = useMemo(() => buildPatientRowUiStateVisibility(activeModal), [activeModal]);

  return useMemo(
    () => ({
      ...visibility,
      openDemographics: () => openModal('demographics'),
      closeDemographics: () => closeModal('demographics'),
      openClinicalDocuments: () => openModal('clinicalDocuments'),
      closeClinicalDocuments: () => closeModal('clinicalDocuments'),
      openExamRequest: () => openModal('examRequest'),
      closeExamRequest: () => closeModal('examRequest'),
      openImagingRequest: () => openModal('imagingRequest'),
      closeImagingRequest: () => closeModal('imagingRequest'),
      openHistory: () => openModal('history'),
      closeHistory: () => closeModal('history'),
    }),
    [closeModal, openModal, visibility]
  );
};
