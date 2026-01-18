import { useState, useEffect } from 'react';
import { MasterPatient } from '@/types';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { isValidRut, formatRut } from '@/utils/rutUtils';

interface UsePatientAutocompleteResult {
    suggestion: MasterPatient | null;
    isLoading: boolean;
    error: Error | null;
    clearSuggestion: () => void;
}

export const usePatientAutocomplete = (rut: string): UsePatientAutocompleteResult => {
    const [suggestion, setSuggestion] = useState<MasterPatient | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isMounted = true;

        const fetchPatient = async () => {
            if (!rut || !isValidRut(rut)) {
                setSuggestion(null);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                // Ensure format matches repository expectation
                const formattedRut = formatRut(rut);
                const data = await PatientMasterRepository.getPatientByRut(formattedRut);

                if (isMounted) {
                    setSuggestion(data);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('[Autocomplete] Error fetching patient:', err);
                    setError(err as Error);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        // Debounce slightly to avoid flooding while typing the last digit
        const timeoutId = setTimeout(fetchPatient, 500);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
        };
    }, [rut]);

    return {
        suggestion,
        isLoading,
        error,
        clearSuggestion: () => setSuggestion(null)
    };
};
