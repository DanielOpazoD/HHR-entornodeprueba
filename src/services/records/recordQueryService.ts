import { DailyRecord, PatientData } from '@/types';
import { getAllRecords, getRecordsForMonth, saveRecord as saveToIndexedDB } from '@/services/storage/indexedDBService';
import { getRecordsRangeFromFirestore } from '@/services/storage/firestoreService';

export const fetchRecordsForMonth = async (year: number, month: number): Promise<DailyRecord[]> => {
    return getRecordsForMonth(year, month);
};

export const fetchExistingDaysInMonth = async (year: number, month: number): Promise<number[]> => {
    const records = await getRecordsForMonth(year, month);

    return records
        .filter(dayRecord => {
            if (!dayRecord || !dayRecord.beds) return false;

            // Check if day has any patients
            return Object.values(dayRecord.beds).some((bed) => {
                const patient = bed as PatientData;
                return patient.patientName && patient.patientName.trim() !== '';
            });
        })
        .map(d => parseInt(d.date.split('-')[2]));
};

export const fetchAllRecordsSorted = async (): Promise<DailyRecord[]> => {
    const recordsMap = await getAllRecords();
    return Object.values(recordsMap).sort((a, b) => b.date.localeCompare(a.date));
};

export const syncRecordsRange = async (start: string, end: string): Promise<DailyRecord[]> => {
    const remoteRecords = await getRecordsRangeFromFirestore(start, end);
    if (remoteRecords.length === 0) return [];

    for (const record of remoteRecords) {
        await saveToIndexedDB(record);
    }
    return remoteRecords;
};
