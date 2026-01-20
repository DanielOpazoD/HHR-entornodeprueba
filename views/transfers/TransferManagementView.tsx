/**
 * Transfer Management View
 * Main view for managing patient transfer requests
 */

import React, { useState } from 'react';
import { TransferTable } from './components/TransferTable';
import { TransferFormModal } from './components/TransferFormModal';
import { StatusChangeModal } from './components/StatusChangeModal';
import { ConfirmTransferModal } from './components/ConfirmTransferModal';
import { CancelTransferModal } from './components/CancelTransferModal';
import { TransferQuestionnaireModal } from './components/TransferQuestionnaireModal';
import { TransferDocumentPackageModal } from './components/TransferDocumentPackageModal';
import { TransferRequest, TransferFormData } from '@/types/transfers';
import { QuestionnaireResponse, TransferPatientData, GeneratedDocument } from '@/types/transferDocuments';
import { useTransferManagement } from '@/hooks/useTransferManagement';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { getHospitalConfigById } from '@/constants/hospitalConfigs';
import { generateTransferDocuments } from '@/services/transfers/documentGeneratorService';

export const TransferManagementView: React.FC = () => {
    const {
        transfers,
        isLoading,
        error,
        createTransfer,
        updateTransfer,
        advanceStatus,
        setTransferStatus,
        markAsTransferred,
        cancelTransfer,
        undoTransfer,
        archiveTransfer,
        deleteHistoryEntry,
        getHospitalizedPatients,
        activeCount
    } = useTransferManagement();

    // Get current daily record to access up-to-date patient data (including birthDate)
    const { record } = useDailyRecordData();

    // Modal states
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isQuestionnaireOpen, setIsQuestionnaireOpen] = useState(false);
    const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
    const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);
    const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);
    const [patientDataForDocs, setPatientDataForDocs] = useState<TransferPatientData | null>(null);

    // Available hospitals for document generation
    // const hospitals = getHospitalConfigs();

    // Form Modal handlers
    const handleNewRequest = () => {
        setSelectedTransfer(null);
        setIsFormModalOpen(true);
    };

    const handleEditTransfer = (transfer: TransferRequest) => {
        setSelectedTransfer(transfer);
        setIsFormModalOpen(true);
    };

    const handleCloseFormModal = () => {
        setIsFormModalOpen(false);
        setSelectedTransfer(null);
    };

    const handleSave = async (data: TransferFormData) => {
        if (selectedTransfer) {
            await updateTransfer(selectedTransfer.id, data);
        } else {
            await createTransfer(data);
        }
        handleCloseFormModal();
    };

    // Status Change handlers
    const handleStatusChange = (transfer: TransferRequest) => {
        setSelectedTransfer(transfer);
        setIsStatusModalOpen(true);
    };

    const handleCloseStatusModal = () => {
        setIsStatusModalOpen(false);
        setSelectedTransfer(null);
    };

    const handleConfirmStatusChange = async (_notes?: string) => {
        if (selectedTransfer) {
            await advanceStatus(selectedTransfer);
        }
    };

    // Transfer Confirmation handlers
    const handleMarkTransferred = (transfer: TransferRequest) => {
        setSelectedTransfer(transfer);
        setIsTransferModalOpen(true);
    };

    const handleCloseTransferModal = () => {
        setIsTransferModalOpen(false);
        setSelectedTransfer(null);
    };

    const handleConfirmTransfer = async (transferMethod: string) => {
        if (selectedTransfer) {
            await markAsTransferred(selectedTransfer, transferMethod);
        }
    };

    // Cancel handlers
    const handleCancel = (transfer: TransferRequest) => {
        setSelectedTransfer(transfer);
        setIsCancelModalOpen(true);
    };

    const handleCloseCancelModal = () => {
        setIsCancelModalOpen(false);
        setSelectedTransfer(null);
    };

    const handleConfirmCancel = async (reason: string) => {
        if (selectedTransfer) {
            await cancelTransfer(selectedTransfer, reason);
        }
    };

    // Document generation handlers
    const handleGenerateDocs = (transfer: TransferRequest) => {
        setSelectedTransfer(transfer);
        setSelectedHospitalId('hospital-salvador'); // Default for now
        setIsQuestionnaireOpen(true);
    };

    const handleCloseQuestionnaire = () => {
        setIsQuestionnaireOpen(false);
        setSelectedTransfer(null);
    };

    const handleQuestionnaireComplete = async (responses: QuestionnaireResponse) => {
        if (!selectedTransfer || !selectedHospitalId) return;

        const hospital = getHospitalConfigById(selectedHospitalId);
        if (!hospital) return;

        setIsGenerating(true);

        try {
            // 1. Persist the responses in Firestore first
            await updateTransfer(selectedTransfer.id, {
                questionnaireResponses: responses
            } as any);

            // 2. Build patient data from transfer snapshot
            // Note: snapshot may have birthDate or just age - also check current census for birthDate
            const snapshot = selectedTransfer.patientSnapshot as any;

            // Try to get birthDate from: 1) snapshot, 2) current census record
            const currentPatient = record?.beds[selectedTransfer.bedId];
            const birthDate = snapshot.birthDate || currentPatient?.birthDate || '';

            const patientData: TransferPatientData = {
                patientName: selectedTransfer.patientSnapshot.name,
                rut: selectedTransfer.patientSnapshot.rut || '',
                birthDate: birthDate,
                age: selectedTransfer.patientSnapshot.age, // Direct age from snapshot
                diagnosis: selectedTransfer.patientSnapshot.diagnosis,
                admissionDate: selectedTransfer.patientSnapshot.admissionDate,
                bedName: selectedTransfer.bedId.replace('BED_', ''),
                bedType: 'Básica',
                isUPC: false,
                originHospital: 'Hospital Hanga Roa'
            };

            // 3. Generate documents
            const documents = await generateTransferDocuments(patientData, responses, hospital);

            // 4. Update state to show package modal instead of auto-downloading
            setGeneratedDocs(documents);
            setPatientDataForDocs(patientData);
            setIsQuestionnaireOpen(false);
            setIsPackageModalOpen(true);

        } catch (error) {
            console.error('Error generating documents:', error);
            alert('Error al generar documentos. Por favor intente nuevamente.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleClosePackageModal = () => {
        setIsPackageModalOpen(false);
        setSelectedTransfer(null);
        setGeneratedDocs([]);
    };

    const handleViewDocs = async (transfer: TransferRequest) => {
        if (!transfer.questionnaireResponses) return;

        setSelectedTransfer(transfer);
        setSelectedHospitalId('hospital-salvador'); // Default

        // Use the same logic as handleQuestionnaireComplete but skipping the modal
        await handleQuestionnaireComplete(transfer.questionnaireResponses);
    };



    return (
        <div className="p-4 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-gray-800">
                        Gestión de Traslados
                    </h1>
                    <span className="px-3 py-1 text-sm font-medium bg-blue-100 text-blue-800 rounded-full">
                        {activeCount} activos
                    </span>
                </div>
                <button
                    onClick={handleNewRequest}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 text-sm font-medium shadow-sm"
                >
                    <span className="text-lg">+</span>
                    Nueva Solicitud
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            {/* Loading State */}
            {isLoading ? (
                <div className="text-center py-12 text-gray-500">
                    Cargando solicitudes de traslado...
                </div>
            ) : (
                /* Table */
                <TransferTable
                    transfers={transfers}
                    onEdit={handleEditTransfer}
                    onStatusChange={handleStatusChange}
                    onQuickStatusChange={setTransferStatus}
                    onMarkTransferred={handleMarkTransferred}
                    onCancel={handleCancel}
                    onGenerateDocs={handleGenerateDocs}
                    onViewDocs={handleViewDocs}
                    onUndo={undoTransfer}
                    onArchive={archiveTransfer}
                    onDeleteHistoryEntry={deleteHistoryEntry}
                />
            )}

            {/* Form Modal */}
            {isFormModalOpen && (
                <TransferFormModal
                    transfer={selectedTransfer}
                    patients={getHospitalizedPatients()}
                    onClose={handleCloseFormModal}
                    onSave={handleSave}
                />
            )}

            {/* Status Change Modal */}
            {isStatusModalOpen && selectedTransfer && (
                <StatusChangeModal
                    transfer={selectedTransfer}
                    onClose={handleCloseStatusModal}
                    onConfirm={handleConfirmStatusChange}
                />
            )}

            {/* Transfer Confirmation Modal */}
            {isTransferModalOpen && selectedTransfer && (
                <ConfirmTransferModal
                    transfer={selectedTransfer}
                    onClose={handleCloseTransferModal}
                    onConfirm={handleConfirmTransfer}
                />
            )}

            {/* Cancel Modal */}
            {isCancelModalOpen && selectedTransfer && (
                <CancelTransferModal
                    transfer={selectedTransfer}
                    onClose={handleCloseCancelModal}
                    onConfirm={handleConfirmCancel}
                />
            )}

            {/* Document Questionnaire Modal */}
            {isQuestionnaireOpen && selectedTransfer && getHospitalConfigById(selectedHospitalId) && (
                <TransferQuestionnaireModal
                    isOpen={isQuestionnaireOpen}
                    hospital={getHospitalConfigById(selectedHospitalId)!}
                    patientData={{
                        patientName: selectedTransfer.patientSnapshot.name,
                        rut: selectedTransfer.patientSnapshot.rut,
                        admissionDate: selectedTransfer.patientSnapshot.admissionDate,
                        diagnosis: selectedTransfer.patientSnapshot.diagnosis,
                        bedName: selectedTransfer.bedId.replace('BED_', ''),
                        bedType: 'Básica',
                        isUPC: false,
                        originHospital: 'Hospital Hanga Roa'
                    }}
                    onClose={handleCloseQuestionnaire}
                    initialResponses={selectedTransfer.questionnaireResponses}
                    onComplete={handleQuestionnaireComplete}
                />
            )}

            {/* Document Package Modal */}
            {isPackageModalOpen && selectedTransfer && patientDataForDocs && (
                <TransferDocumentPackageModal
                    isOpen={isPackageModalOpen}
                    hospital={getHospitalConfigById(selectedHospitalId)!}
                    patientData={patientDataForDocs}
                    documents={generatedDocs}
                    onClose={handleClosePackageModal}
                />
            )}

            {/* Generating Overlay */}
            {isGenerating && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-md">
                    <div className="bg-white px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <p className="font-semibold text-slate-700">Preparando documentos...</p>
                        <p className="text-sm text-slate-500 italic">Por favor espere un momento</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TransferManagementView;
