/**
 * Transfer Management View
 * Main view for managing patient transfer requests
 */

import React from 'react';
import { TransferTable } from './components/TransferTable';
import { TransferFormModal } from './components/TransferFormModal';
import { StatusChangeModal } from './components/StatusChangeModal';
import { ConfirmTransferModal } from './components/ConfirmTransferModal';
import { CancelTransferModal } from './components/CancelTransferModal';
import { TransferQuestionnaireModal } from './components/TransferQuestionnaireModal';
import { TransferDocumentPackageModal } from './components/TransferDocumentPackageModal';
import { useTransferManagement } from '@/hooks/useTransferManagement';
import { useTransferViewStates } from '@/hooks/useTransferViewStates';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { getHospitalConfigById } from '@/constants/hospitalConfigs';

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

    const { record } = useDailyRecordData();

    const {
        modals,
        selectedTransfer,
        selectedHospitalId,
        isGenerating,
        generatedDocs,
        patientDataForDocs,
        handlers
    } = useTransferViewStates(
        record,
        updateTransfer,
        createTransfer,
        advanceStatus,
        markAsTransferred,
        cancelTransfer
    );

    return (
        <div className="p-4 max-w-7xl mx-auto animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-gray-800">
                        Gestión de Traslados
                    </h1>
                    <span className="px-3 py-1 text-sm font-medium bg-blue-100 text-blue-800 rounded-full shadow-sm">
                        {activeCount} activos
                    </span>
                </div>
                <button
                    onClick={handlers.handleNewRequest}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 text-sm font-bold shadow-lg shadow-blue-100 active:scale-95"
                >
                    <span className="text-lg">+</span>
                    Nueva Solicitud
                </button>
            </div>

            {/* Notifications */}
            {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-center gap-3 animate-in slide-in-from-top-2">
                    <span className="font-bold">⚠️ Error:</span> {error}
                </div>
            )}

            {/* Main Content */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {isLoading ? (
                    <div className="text-center py-20">
                        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-gray-400 font-medium tracking-tight">Cargando solicitudes...</p>
                    </div>
                ) : (
                    <TransferTable
                        transfers={transfers}
                        onEdit={handlers.handleEditTransfer}
                        onStatusChange={handlers.handleStatusChange}
                        onQuickStatusChange={setTransferStatus}
                        onMarkTransferred={handlers.handleMarkTransferred}
                        onCancel={handlers.handleCancel}
                        onGenerateDocs={handlers.handleGenerateDocs}
                        onViewDocs={handlers.handleViewDocs}
                        onUndo={undoTransfer}
                        onArchive={archiveTransfer}
                        onDeleteHistoryEntry={deleteHistoryEntry}
                    />
                )}
            </div>

            {/* Modals Orchestration */}
            {modals.form && (
                <TransferFormModal
                    transfer={selectedTransfer}
                    patients={getHospitalizedPatients()}
                    onClose={handlers.handleCloseFormModal}
                    onSave={handlers.handleSave}
                />
            )}

            {modals.status && selectedTransfer && (
                <StatusChangeModal
                    transfer={selectedTransfer}
                    onClose={handlers.handleCloseStatusModal}
                    onConfirm={handlers.handleConfirmStatusChange}
                />
            )}

            {modals.transfer && selectedTransfer && (
                <ConfirmTransferModal
                    transfer={selectedTransfer}
                    onClose={handlers.handleCloseTransferModal}
                    onConfirm={handlers.handleConfirmTransfer}
                />
            )}

            {modals.cancel && selectedTransfer && (
                <CancelTransferModal
                    transfer={selectedTransfer}
                    onClose={handlers.handleCloseCancelModal}
                    onConfirm={handlers.handleConfirmCancel}
                />
            )}

            {modals.questionnaire && selectedTransfer && (
                <TransferQuestionnaireModal
                    isOpen={modals.questionnaire}
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
                    onClose={handlers.handleCloseQuestionnaire}
                    initialResponses={selectedTransfer.questionnaireResponses}
                    onComplete={handlers.handleQuestionnaireComplete}
                />
            )}

            {modals.package && selectedTransfer && patientDataForDocs && (
                <TransferDocumentPackageModal
                    isOpen={modals.package}
                    hospital={getHospitalConfigById(selectedHospitalId)!}
                    patientData={patientDataForDocs}
                    documents={generatedDocs}
                    onClose={handlers.handleClosePackageModal}
                />
            )}

            {/* Processing Overlay */}
            {isGenerating && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white px-10 py-8 rounded-[2rem] shadow-2xl flex flex-col items-center gap-5 border border-white">
                        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <div className="text-center">
                            <p className="font-black text-slate-800 text-lg tracking-tight">Preparando documentos</p>
                            <p className="text-sm text-slate-400 font-medium">Esto puede tomar unos segundos</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TransferManagementView;
