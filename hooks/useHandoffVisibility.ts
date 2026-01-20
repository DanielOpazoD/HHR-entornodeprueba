import { useCallback, useMemo } from 'react';
import { DailyRecord } from '../types';
import { BEDS } from '../constants';
import { isAdmittedDuringShift } from '../utils/dateUtils';

export type NursingShift = 'day' | 'night';

/**
 * useHandoffVisibility Hook
 * 
 * Handles filtering and visibility of patients and beds based on the current shift.
 */
export const useHandoffVisibility = (
    record: DailyRecord | null,
    selectedShift: NursingShift
) => {
    /**
     * Determines if a bed should be visible (ignores extra beds if they are not active)
     */
    const visibleBeds = useMemo(() => {
        if (!record) return [];
        const activeExtras = record.activeExtraBeds || [];
        return BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
    }, [record]);

    /**
     * Determines if a patient in a bed should be shown in the current shift
     */
    const shouldShowPatient = useCallback((bedId: string): boolean => {
        if (!record) return false;

        const patient = record.beds[bedId];
        if (!patient) return false;
        if (patient.isBlocked) return true; // Always show blocked beds
        if (!patient.patientName) return false;

        return isAdmittedDuringShift(
            record.date,
            patient.admissionDate,
            patient.admissionTime,
            selectedShift
        );
    }, [record, selectedShift]);

    /**
     * Checks if there are any patients to show in the current view
     */
    const hasAnyPatients = useMemo(() => {
        if (!record) return false;
        return visibleBeds.some(b => {
            const patient = record.beds[b.id];
            if (!patient?.patientName && !patient?.isBlocked) return false;
            if (patient?.isBlocked) return true;
            return shouldShowPatient(b.id);
        });
    }, [visibleBeds, record, shouldShowPatient]);

    return {
        visibleBeds,
        shouldShowPatient,
        hasAnyPatients
    };
};
