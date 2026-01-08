/**
 * usePatientHistoryQuery Hook
 * TanStack Query wrapper for patient history.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPatientHistory } from '../services/patient/patientHistoryService';

export const usePatientHistoryQuery = (rut: string | null) => {
    return useQuery({
        queryKey: ['patientHistory', rut],
        queryFn: async () => {
            if (!rut) return null;
            return await getPatientHistory(rut);
        },
        enabled: !!rut,
        staleTime: 1000 * 60 * 60, // 1 hour (history changes rarely during a shift)
    });
};

/**
 * Hook to manually invalidate patient history if needed.
 */
export const useInvalidatePatientHistory = () => {
    const queryClient = useQueryClient();
    return (rut: string) => queryClient.invalidateQueries({ queryKey: ['patientHistory', rut] });
};
