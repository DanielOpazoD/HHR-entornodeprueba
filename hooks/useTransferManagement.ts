/**
 * useTransferManagement Hook
 * Manages transfer requests state and operations
 */

import { useState, useEffect, useCallback } from 'react';
import { TransferRequest, TransferFormData, PatientSnapshot } from '../types/transfers';
import { PatientData } from '../types';
import {
    subscribeToTransfers,
    createTransferRequest,
    updateTransferRequest,
    changeTransferStatus,
    completeTransfer,
    deleteTransferRequest
} from '../services/transfers/transferService';
import { getNextStatus } from '../constants/transferConstants';
import { useAuth } from '../context/AuthContext';
import { useDailyRecordContext } from '../context/DailyRecordContext';

interface UseTransferManagementReturn {
    // State
    transfers: TransferRequest[];
    isLoading: boolean;
    error: string | null;

    // Operations
    createTransfer: (data: TransferFormData) => Promise<void>;
    updateTransfer: (id: string, data: Partial<TransferFormData>) => Promise<void>;
    advanceStatus: (transfer: TransferRequest) => Promise<void>;
    markAsTransferred: (transfer: TransferRequest, transferMethod: string) => Promise<void>;
    cancelTransfer: (transfer: TransferRequest, reason: string) => Promise<void>;
    deleteTransfer: (id: string) => Promise<void>;

    // Helpers
    getHospitalizedPatients: () => { id: string; name: string; bedId: string; diagnosis: string }[];
    activeCount: number;
}

export const useTransferManagement = (): UseTransferManagementReturn => {
    const [transfers, setTransfers] = useState<TransferRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { user } = useAuth();
    const { record, addTransfer, clearPatient } = useDailyRecordContext();

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

    const activeCount = transfers.filter(t => t.status !== 'TRANSFERRED' && t.status !== 'CANCELLED').length;

    return {
        transfers,
        isLoading,
        error,
        createTransfer,
        updateTransfer,
        advanceStatus,
        markAsTransferred,
        cancelTransfer,
        deleteTransfer,
        getHospitalizedPatients,
        activeCount
    };
};
