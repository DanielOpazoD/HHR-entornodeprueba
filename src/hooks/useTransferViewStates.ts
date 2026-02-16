import { useState, useCallback } from 'react';
import { TransferRequest, TransferFormData } from '@/types/transfers';
import {
  QuestionnaireResponse,
  TransferPatientData,
  GeneratedDocument,
} from '@/types/transferDocuments';
import { getHospitalConfigById } from '@/constants/hospitalConfigs';
import { generateTransferDocuments } from '@/services/transfers/documentGeneratorService';
import { DailyRecord } from '@/types';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export const useTransferViewStates = (
  record: DailyRecord | null,
  updateTransfer: (id: string, data: Partial<TransferRequest>) => Promise<void>,
  createTransfer: (data: TransferFormData) => Promise<void>,
  advanceStatus: (transfer: TransferRequest) => Promise<void>,
  markAsTransferred: (transfer: TransferRequest, method: string) => Promise<void>,
  cancelTransfer: (transfer: TransferRequest, reason: string) => Promise<void>
) => {
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isQuestionnaireOpen, setIsQuestionnaireOpen] = useState(false);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('hospital-salvador');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);
  const [patientDataForDocs, setPatientDataForDocs] = useState<TransferPatientData | null>(null);

  const handleNewRequest = useCallback(() => {
    setSelectedTransfer(null);
    setIsFormModalOpen(true);
  }, []);

  const handleEditTransfer = useCallback((transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    setIsFormModalOpen(true);
  }, []);

  const handleCloseFormModal = useCallback(() => {
    setIsFormModalOpen(false);
    setSelectedTransfer(null);
  }, []);

  const handleSave = async (data: TransferFormData) => {
    if (selectedTransfer) {
      await updateTransfer(selectedTransfer.id, data);
    } else {
      await createTransfer(data);
    }
    handleCloseFormModal();
  };

  const handleStatusChange = useCallback((transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    setIsStatusModalOpen(true);
  }, []);

  const handleCloseStatusModal = useCallback(() => {
    setIsStatusModalOpen(false);
    setSelectedTransfer(null);
  }, []);

  const handleConfirmStatusChange = async (_notes?: string) => {
    if (selectedTransfer) {
      await advanceStatus(selectedTransfer);
    }
  };

  const handleMarkTransferred = useCallback((transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    setIsTransferModalOpen(true);
  }, []);

  const handleCloseTransferModal = useCallback(() => {
    setIsTransferModalOpen(false);
    setSelectedTransfer(null);
  }, []);

  const handleConfirmTransfer = async (transferMethod: string) => {
    if (selectedTransfer) {
      await markAsTransferred(selectedTransfer, transferMethod);
    }
  };

  const handleCancel = useCallback((transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    setIsCancelModalOpen(true);
  }, []);

  const handleCloseCancelModal = useCallback(() => {
    setIsCancelModalOpen(false);
    setSelectedTransfer(null);
  }, []);

  const handleConfirmCancel = async (reason: string) => {
    if (selectedTransfer) {
      await cancelTransfer(selectedTransfer, reason);
    }
  };

  const handleGenerateDocs = useCallback((transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    setSelectedHospitalId('hospital-salvador');
    setIsQuestionnaireOpen(true);
  }, []);

  const handleCloseQuestionnaire = useCallback(() => {
    setIsQuestionnaireOpen(false);
    setSelectedTransfer(null);
  }, []);

  const handleQuestionnaireComplete = useCallback(
    async (responses: QuestionnaireResponse) => {
      if (!selectedTransfer || !selectedHospitalId) return;

      const hospital = getHospitalConfigById(selectedHospitalId);
      if (!hospital) return;

      setIsGenerating(true);
      try {
        await updateTransfer(selectedTransfer.id, {
          questionnaireResponses: responses,
        });

        // Access birthDate from patientSnapshot which may have extended fields
        const currentPatient = record?.beds[selectedTransfer.bedId];
        const snapshotBirthDate =
          'birthDate' in selectedTransfer.patientSnapshot
            ? (selectedTransfer.patientSnapshot.birthDate as string)
            : undefined;
        const birthDate = snapshotBirthDate || currentPatient?.birthDate || '';

        const patientData: TransferPatientData = {
          patientName: selectedTransfer.patientSnapshot.name,
          rut: selectedTransfer.patientSnapshot.rut || '',
          birthDate: birthDate,
          age: selectedTransfer.patientSnapshot.age,
          diagnosis: selectedTransfer.patientSnapshot.diagnosis,
          admissionDate: selectedTransfer.patientSnapshot.admissionDate,
          bedName: selectedTransfer.bedId.replace('BED_', ''),
          bedType: 'Básica',
          isUPC: false,
          originHospital: 'Hospital Hanga Roa',
        };

        const documents = await generateTransferDocuments(patientData, responses, hospital);
        setGeneratedDocs(documents);
        setPatientDataForDocs(patientData);
        setIsQuestionnaireOpen(false);
        setIsPackageModalOpen(true);
      } catch (error) {
        console.error('Error generating documents:', error);
        defaultBrowserWindowRuntime.alert(
          'Error al generar documentos. Por favor intente nuevamente.'
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [selectedTransfer, selectedHospitalId, updateTransfer, record]
  );

  const handleViewDocs = useCallback(
    async (transfer: TransferRequest) => {
      if (!transfer.questionnaireResponses) return;
      setSelectedTransfer(transfer);
      setSelectedHospitalId('hospital-salvador');
      await handleQuestionnaireComplete(transfer.questionnaireResponses);
    },
    [handleQuestionnaireComplete]
  );

  const handleClosePackageModal = useCallback(() => {
    setIsPackageModalOpen(false);
    setSelectedTransfer(null);
    setGeneratedDocs([]);
  }, []);

  return {
    modals: {
      form: isFormModalOpen,
      status: isStatusModalOpen,
      transfer: isTransferModalOpen,
      cancel: isCancelModalOpen,
      questionnaire: isQuestionnaireOpen,
      package: isPackageModalOpen,
    },
    selectedTransfer,
    selectedHospitalId,
    isGenerating,
    generatedDocs,
    patientDataForDocs,
    handlers: {
      handleNewRequest,
      handleEditTransfer,
      handleCloseFormModal,
      handleSave,
      handleStatusChange,
      handleCloseStatusModal,
      handleConfirmStatusChange,
      handleMarkTransferred,
      handleCloseTransferModal,
      handleConfirmTransfer,
      handleCancel,
      handleCloseCancelModal,
      handleConfirmCancel,
      handleGenerateDocs,
      handleCloseQuestionnaire,
      handleQuestionnaireComplete,
      handleViewDocs,
      handleClosePackageModal,
    },
  };
};
