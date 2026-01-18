/**
 * useTransferManagement Hook
 * Manages transfer requests state and operations
 */

import { useState, useEffect, useCallback } from 'react';
import { TransferRequest, TransferFormData, PatientSnapshot, TransferStatus } from '../types/transfers';
import { PatientData } from '../types';
import {
    subscribeToTransfers,
    createTransferRequest,
    updateTransferRequest,
    changeTransferStatus,
    completeTransfer,
    deleteTransferRequest,
    deleteStatusHistoryEntry
} from '../services/transfers/transferService';
import { getNextStatus } from '../constants/transferConstants';
import { useAuth } from '../context/AuthContext';
import { useDailyRecordData, useDailyRecordActions } from '../context/DailyRecordContext';

interface UseTransferManagementReturn {
    // State
    transfers: TransferRequest[];
    isLoading: boolean;
    error: string | null;

    // Operations
    createTransfer: (data: TransferFormData) => Promise<void>;
    updateTransfer: (id: string, data: Partial<TransferFormData>) => Promise<void>;
    advanceStatus: (transfer: TransferRequest) => Promise<void>;
    setTransferStatus: (transfer: TransferRequest, status: TransferStatus) => Promise<void>;
    markAsTransferred: (transfer: TransferRequest, transferMethod: string) => Promise<void>;
    cancelTransfer: (transfer: TransferRequest, reason: string) => Promise<void>;
    deleteTransfer: (id: string) => Promise<void>;
    undoTransfer: (transfer: TransferRequest) => Promise<void>;
    archiveTransfer: (transfer: TransferRequest) => Promise<void>;
    deleteHistoryEntry: (transfer: TransferRequest, historyIndex: number) => Promise<void>;

    // Helpers
    getHospitalizedPatients: () => { id: string; name: string; bedId: string; diagnosis: string }[];
    activeCount: number;
}

export const useTransferManagement = (): UseTransferManagementReturn => {
    const [transfers, setTransfers] = useState<TransferRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { user } = useAuth();
    const { record } = useDailyRecordData();
    const { addTransfer, clearPatient } = useDailyRecordActions();

    // Subscribe to transfers on mount
    useEffect(() => {
        setIsLoading(true);
        const unsubscribe = subscribeToTransfers((data) => {
            setTransfers(data);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Get list of hospitalized patients for the selector
    const getHospitalizedPatients = useCallback(() => {
        if (!record?.beds) return [];

        return Object.entries(record.beds)
            .filter(([, patient]: [string, PatientData]) => patient.patientName && !patient.isBlocked)
            .map(([bedId, patient]: [string, PatientData]) => ({
                id: bedId,
                name: patient.patientName,
                bedId: bedId,
                diagnosis: patient.pathology || 'Sin diagnóstico'
            }));
    }, [record]);

    // Create a new transfer request
    const createTransfer = useCallback(async (data: TransferFormData) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        if (!record?.beds) {
            setError('No hay registro diario cargado');
            return;
        }

        const patient = record.beds[data.bedId];
        if (!patient) {
            setError('Paciente no encontrado');
            return;
        }

        // Create patient snapshot
        const patientSnapshot: PatientSnapshot = {
            name: patient.patientName,
            rut: patient.rut || 'Sin RUT',
            age: parseInt(patient.age) || 0,
            birthDate: patient.birthDate, // Copy birth date from census
            sex: patient.biologicalSex === 'Masculino' ? 'M' : 'F',
            diagnosis: patient.pathology || 'Sin diagnóstico',
            secondaryDiagnoses: patient.diagnosisComments ? [patient.diagnosisComments] : undefined,
            admissionDate: patient.admissionDate || record.date
        };

        try {
            await createTransferRequest({
                patientId: data.bedId,
                bedId: data.bedId,
                patientSnapshot,
                destinationHospital: data.destinationHospital,
                transferReason: data.transferReason,
                requestingDoctor: data.requestingDoctor,
                requiredSpecialty: data.requiredSpecialty,
                observations: data.observations,
                customFields: data.customFields || {},
                status: 'REQUESTED',
                requestDate: new Date().toISOString().split('T')[0],
                createdBy: user.email
            });
            setError(null);
        } catch (err) {
            console.error('Error creating transfer:', err);
            setError('Error al crear la solicitud de traslado');
        }
    }, [user, record]);

    // Update an existing transfer
    const updateTransfer = useCallback(async (id: string, data: Partial<TransferFormData>) => {
        try {
            await updateTransferRequest(id, data);
            setError(null);
        } catch (err) {
            console.error('Error updating transfer:', err);
            setError('Error al actualizar la solicitud');
        }
    }, []);

    // Advance to next status
    const advanceStatus = useCallback(async (transfer: TransferRequest) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        const nextStatus = getNextStatus(transfer.status);
        if (!nextStatus) {
            setError('El traslado ya está en su estado final');
            return;
        }

        try {
            await changeTransferStatus(transfer.id, nextStatus, user.email);
            setError(null);
        } catch (err) {
            console.error('Error advancing status:', err);
            setError('Error al cambiar el estado');
        }
    }, [user]);

    // Set a specific status
    const setTransferStatus = useCallback(async (transfer: TransferRequest, status: TransferStatus) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        try {
            await changeTransferStatus(transfer.id, status, user.email);
            setError(null);
        } catch (err) {
            console.error('Error setting status:', err);
            setError('Error al cambiar el estado');
        }
    }, [user]);

    // Mark as transferred (complete) and integrate with daily census
    const markAsTransferred = useCallback(async (transfer: TransferRequest, transferMethod: string) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        try {
            // 1. Complete the transfer request in Firestore
            await completeTransfer(transfer.id, user.email);

            // 2. Add to daily census transfers array
            addTransfer(
                transfer.bedId,
                transferMethod,
                transfer.destinationHospital,
                '', // centerOther - not needed as hospital is already selected
                undefined, // escort
                new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
            );

            // 3. Clear the patient from the bed (bed is now free)
            clearPatient(transfer.bedId);

            setError(null);
            console.log(`✅ Traslado completado: ${transfer.patientSnapshot.name} → ${transfer.destinationHospital}`);
        } catch (err) {
            console.error('Error completing transfer:', err);
            setError('Error al completar el traslado');
        }
    }, [user, addTransfer, clearPatient]);

    // Cancel a transfer request
    const cancelTransfer = useCallback(async (transfer: TransferRequest, reason: string) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        try {
            await changeTransferStatus(transfer.id, 'CANCELLED', user.email, reason);
            setError(null);
            console.log(`❌ Traslado cancelado: ${transfer.patientSnapshot.name} - Razón: ${reason}`);
        } catch (err) {
            console.error('Error cancelling transfer:', err);
            setError('Error al cancelar el traslado');
        }
    }, [user]);

    // Delete a transfer request
    const deleteTransfer = useCallback(async (id: string) => {
        try {
            await deleteTransferRequest(id);
            setError(null);
        } catch (err) {
            console.error('Error deleting transfer:', err);
            setError('Error al eliminar la solicitud');
        }
    }, []);

    // Undo a transfer (revert to previous status, typically ACCEPTED)
    const undoTransfer = useCallback(async (transfer: TransferRequest) => {
        if (!user?.email) {
            setError('Usuario no autenticado');
            return;
        }

        // Find the previous status from history
        const prevChange = transfer.statusHistory.length >= 2
            ? transfer.statusHistory[transfer.statusHistory.length - 2]
            : null;
        const prevStatus = prevChange?.to || 'ACCEPTED';

        try {
            await changeTransferStatus(transfer.id, prevStatus, user.email, 'Traslado deshecho');
            setError(null);
            console.log(`↩️ Traslado deshecho: ${transfer.patientSnapshot.name} → ${prevStatus}`);
        } catch (err) {
            console.error('Error undoing transfer:', err);
            setError('Error al deshacer el traslado');
        }
    }, [user]);

    // Archive a transfer (hide from list until next day auto-cleanup)
    const archiveTransfer = useCallback(async (transfer: TransferRequest) => {
        try {
            await updateTransferRequest(transfer.id, {
                archived: true,
                archivedAt: new Date().toISOString()
            } as any);
            setError(null);
            console.log(`📦 Traslado archivado: ${transfer.patientSnapshot.name}`);
        } catch (err) {
            console.error('Error archiving transfer:', err);
            setError('Error al archivar el traslado');
        }
    }, []);

    // Delete a specific history entry (for correcting mistakes)
    const deleteHistoryEntry = useCallback(async (transfer: TransferRequest, historyIndex: number) => {
        try {
            await deleteStatusHistoryEntry(transfer.id, historyIndex);
            setError(null);
            console.log(`🗑️ Historial eliminado: ${transfer.patientSnapshot.name} índice ${historyIndex}`);
        } catch (err) {
            console.error('Error deleting history entry:', err);
            setError('Error al eliminar el registro del historial');
        }
    }, []);

    // Filter out archived transfers and old completed ones (auto-cleanup next day)
    const today = new Date().toISOString().split('T')[0];
    const visibleTransfers = transfers.filter(t => {
        // Always hide archived
        if (t.archived) return false;
        // Auto-hide transferred/cancelled from previous days
        if ((t.status === 'TRANSFERRED' || t.status === 'CANCELLED') && t.updatedAt < today) return false;
        return true;
    });

    const activeCount = visibleTransfers.filter(t => t.status !== 'TRANSFERRED' && t.status !== 'CANCELLED').length;

    return {
        transfers: visibleTransfers,
        isLoading,
        error,
        createTransfer,
        updateTransfer,
        advanceStatus,
        setTransferStatus,
        markAsTransferred,
        cancelTransfer,
        deleteTransfer,
        undoTransfer,
        archiveTransfer,
        deleteHistoryEntry,
        getHospitalizedPatients,
        activeCount
    };
};
