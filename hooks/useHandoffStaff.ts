import { useMemo } from 'react';
import { DailyRecord } from '../types';

export type NursingShift = 'day' | 'night';

/**
 * useHandoffStaff Hook
 * 
 * Manages staff lists (delivering, receiving, TENS) derived from the DailyRecord.
 */
export const useHandoffStaff = (
    record: DailyRecord | null,
    selectedShift: NursingShift
) => {
    const deliversList = useMemo(() => {
        if (!record) return [];
        return selectedShift === 'day'
            ? (record.nursesDayShift || [])
            : (record.nursesNightShift || []);
    }, [record, selectedShift]);

    const receivesList = useMemo(() => {
        if (!record) return [];
        return selectedShift === 'day'
            ? (record.nursesNightShift || [])
            : (record.handoffNightReceives || []);
    }, [record, selectedShift]);

    const tensList = useMemo(() => {
        if (!record) return [];
        return selectedShift === 'day'
            ? (record.tensDayShift || [])
            : (record.tensNightShift || []);
    }, [record, selectedShift]);

    return {
        deliversList,
        receivesList,
        tensList
    };
};
