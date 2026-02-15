import { useCallback } from 'react';
import { executeActivateEmptyBedController } from '@/features/census/controllers/censusEmptyBedActivationController';

interface UseEmptyBedActivationParams {
    updatePatient: (bedId: string, field: 'patientName', value: string) => void;
}

interface UseEmptyBedActivationResult {
    activateEmptyBed: (bedId: string) => void;
}

export const useEmptyBedActivation = ({
    updatePatient
}: UseEmptyBedActivationParams): UseEmptyBedActivationResult => {
    const activateEmptyBed = useCallback((bedId: string) => {
        executeActivateEmptyBedController({
            bedId,
            runtime: {
                updatePatient,
                requestFrame: (callback) => {
                    const raf = typeof window !== 'undefined' ? window.requestAnimationFrame : undefined;
                    if (!raf) {
                        callback();
                        return;
                    }
                    raf(callback);
                },
                querySelector: (selector) => document.querySelector(selector)
            }
        });
    }, [updatePatient]);

    return { activateEmptyBed };
};
