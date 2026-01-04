/**
 * usePatientHistory Hook
 * Manages patient history state and loading
 */

import { useState, useCallback } from 'react';
import { getPatientHistory, PatientHistory } from '../services/patient/patientHistoryService';

interface UsePatientHistoryReturn {
    history: PatientHistory | null;
    isLoading: boolean;
    error: string | null;
    loadHistory: (rut: string) => Promise<void>;
    clearHistory: () => void;
}

export const usePatientHistory = (): UsePatientHistoryReturn => {
    const [history, setHistory] = useState<PatientHistory | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadHistory = useCallback(async (rut: string) => {
        if (!rut) {
            setError('RUT no proporcionado');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const result = await getPatientHistory(rut);
            if (result) {
                setHistory(result);
            } else {
                setError('No se encontraron registros para este paciente');
            }
        } catch (err) {
            console.error('Error loading patient history:', err);
            setError('Error al cargar el historial del paciente');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const clearHistory = useCallback(() => {
        setHistory(null);
        setError(null);
    }, []);

    return {
        history,
        isLoading,
        error,
        loadHistory,
        clearHistory
    };
};
