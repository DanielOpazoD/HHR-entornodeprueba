import { useMemo } from 'react';
import { DailyRecord, PatientData } from '../types';
import { BEDS, HOSPITAL_CAPACITY } from '../constants';

/**
 * Hook to manage hospital inventory summaries.
 * Provides computed stats about beds and patients.
 */
export const useInventory = (record: DailyRecord | null) => {
    return useMemo(() => {
        if (!record) {
            return {
                occupiedCount: 0,
                blockedCount: 0,
                availableCount: HOSPITAL_CAPACITY,
                occupancyRate: 0,
                occupiedBeds: [],
                freeBeds: [],
                blockedBeds: [],
                isFull: false
            };
        }

        const beds = record.beds || {};
        const occupiedBeds: string[] = [];
        const blockedBeds: string[] = [];
        const freeBeds: string[] = [];

        BEDS.forEach(bed => {
            const data = beds[bed.id];
            if (data?.isBlocked) {
                blockedBeds.push(bed.id);
            } else if (data?.patientName?.trim()) {
                occupiedBeds.push(bed.id);
            } else {
                freeBeds.push(bed.id);
            }
        });

        const occupiedCount = occupiedBeds.length;
        const blockedCount = blockedBeds.length;
        const availableCount = HOSPITAL_CAPACITY - blockedCount;
        const occupancyRate = availableCount > 0 ? (occupiedCount / availableCount) * 100 : 0;

        return {
            occupiedCount,
            blockedCount,
            availableCount,
            occupancyRate,
            occupiedBeds,
            freeBeds,
            blockedBeds,
            isFull: occupiedCount >= availableCount
        };
    }, [record]);
};
