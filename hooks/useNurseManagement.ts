/**
 * Nurse and TENS Management Hooks
 * 
 * ## CRITICAL DESIGN PHILOSOPHY
 * 
 * These hooks manage staff assignments in the **Census Daily** record.
 * The Census is the SINGLE SOURCE OF TRUTH for staff data.
 * 
 * **Data Flow:**
 * 1. User selects nurse/TENS in Census view (NurseSelector, TensSelector)
 * 2. `updateNurse`/`updateTens` updates `nursesDayShift`, etc. in the DailyRecord
 * 3. DailyRecord is synced to Firestore via `patchRecord`
 * 4. Handoff view reads directly from these fields via `useHandoffLogic`
 * 
 * **Important Implementation Details:**
 * - We send the COMPLETE array to Firestore, not individual indices
 * - Firestore doesn't handle array index updates via dot notation well
 * - This ensures atomic updates and prevents race conditions
 * 
 * @see useHandoffLogic - Consumes the staff data for display in Handoff view
 */
import { DailyRecord } from '../types';
import { DailyRecordPatch } from './useDailyRecordTypes';

export const useNurseManagement = (
    record: DailyRecord | null,
    patchRecord: (partial: DailyRecordPatch) => Promise<void>
) => {

    const updateNurse = async (shift: 'day' | 'night', index: number, name: string) => {
        // console.debug('[NurseManagement] updateNurse called:', shift, index, name, 'record:', !!record);
        if (!record) return;

        const field = shift === 'day' ? 'nursesDayShift' : 'nursesNightShift';

        // Get current array and create a new one with the updated value
        // IMPORTANT: Send the complete array to Firestore, not individual indices
        // Firestore doesn't handle array index updates via dot notation well
        const currentArray = [...(record[field] || ['', ''])];
        // Ensure array has at least index+1 elements
        while (currentArray.length <= index) {
            currentArray.push('');
        }
        currentArray[index] = name;

        // console.debug('[NurseManagement] Sending complete array:', field, '=', currentArray);
        await patchRecord({ [field]: currentArray } as unknown as DailyRecordPatch);
    };

    return {
        updateNurse
    };
};

export const useTensManagement = (
    record: DailyRecord | null,
    patchRecord: (partial: DailyRecordPatch) => Promise<void>
) => {

    const updateTens = async (shift: 'day' | 'night', index: number, name: string) => {
        if (!record) return;

        const field = shift === 'day' ? 'tensDayShift' : 'tensNightShift';

        // Get current array and create a new one with the updated value
        // IMPORTANT: Send the complete array to Firestore, not individual indices
        // Firestore doesn't handle array index updates via dot notation well
        const currentArray = [...(record[field] || ['', '', ''])];
        // Ensure array has at least index+1 elements
        while (currentArray.length <= index) {
            currentArray.push('');
        }
        currentArray[index] = name;

        // console.debug('[TensManagement] Sending complete array:', field, '=', currentArray);
        await patchRecord({ [field]: currentArray } as unknown as DailyRecordPatch);
    };

    return {
        updateTens
    };
};
