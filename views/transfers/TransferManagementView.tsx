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
import { TransferRequest, TransferFormData } from '../../types/transfers';
import { useTransferManagement } from '../../hooks/useTransferManagement';

export const TransferManagementView: React.FC = () => {
    const {
        transfers,
        isLoading,
        error,
        createTransfer,
        updateTransfer,
        advanceStatus,
        markAsTransferred,
        cancelTransfer,
        getHospitalizedPatients,
        activeCount
    } = useTransferManagement();

    // Modal states
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);

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
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                    <span>+</span>
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
                    onMarkTransferred={handleMarkTransferred}
                    onCancel={handleCancel}
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
        </div>
    );
};

export default TransferManagementView;
