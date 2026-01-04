/**
 * Patient History Service
 * Searches for all hospitalizations of a patient by RUT across daily records.
 * 
 * @description This service queries Firestore for all daily records and finds
 * appearances of a patient based on their RUT. It then groups consecutive
 * appearances into hospitalization periods.
 * 
 * Performance optimizations:
 * - Limits query to last 365 days
 * - Caches results for 5 minutes to avoid repeated queries
 */

import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { DailyRecord } from '../../types';
import { COLLECTIONS, HOSPITAL_ID, HOSPITAL_COLLECTIONS } from '../../constants/firestorePaths';

// ============= Types =============

export interface PatientHospitalization {
    recordDate: string;
    bedId: string;
    bedLabel: string;
    diagnosis: string;
    admissionDate: string;
    service: string;
    patientName: string;
}

export interface PatientHistoryGroup {
    admissionDate: string;
    dischargeDate: string | null;
    daysStayed: number;
    diagnosis: string;
    service: string;
    bedId: string;
    records: PatientHospitalization[];
}

export interface PatientHistory {
    rut: string;
    name: string;
    currentHospitalization: PatientHospitalization | null;
    pastHospitalizations: PatientHistoryGroup[];
    totalHospitalizations: number;
    totalDaysHospitalized: number;
}

// ============= Cache =============

interface CachedHistory {
    data: PatientHistory;
    timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const historyCache = new Map<string, CachedHistory>();

/**
 * Get cached history if still valid
 */
const getCachedHistory = (rut: string): PatientHistory | null => {
    const normalizedRut = normalizeRut(rut);
    const cached = historyCache.get(normalizedRut);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`📦 Cache hit for RUT: ${rut}`);
        return cached.data;
    }

    return null;
};

/**
 * Store history in cache
 */
const setCachedHistory = (rut: string, data: PatientHistory): void => {
    const normalizedRut = normalizeRut(rut);
    historyCache.set(normalizedRut, {
        data,
        timestamp: Date.now()
    });
};

/**
 * Clear cache for a specific RUT or all
 */
export const clearHistoryCache = (rut?: string): void => {
    if (rut) {
        historyCache.delete(normalizeRut(rut));
    } else {
        historyCache.clear();
    }
};

// ============= Helpers =============

/**
 * Get collection reference for daily records
 */
const getRecordsCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    HOSPITAL_ID,
    HOSPITAL_COLLECTIONS.DAILY_RECORDS
);

/**
 * Normalize RUT for comparison (remove dots, dashes, lowercase)
 */
const normalizeRut = (rut: string): string => {
    return rut.toLowerCase().replace(/\./g, '').replace(/-/g, '').trim();
};

/**
 * Get all daily records from Firestore (last 365 days for performance)
 */
const getAllDailyRecords = async (): Promise<Map<string, DailyRecord>> => {
    const recordsRef = getRecordsCollection();
    const q = query(recordsRef, orderBy('date', 'desc'), limit(365));

    const snapshot = await getDocs(q);
    const records = new Map<string, DailyRecord>();

    snapshot.forEach(doc => {
        records.set(doc.id, doc.data() as DailyRecord);
    });

    return records;
};

/**
 * Find all records where a patient with given RUT appears
 */
const findPatientRecords = (
    records: Map<string, DailyRecord>,
    rut: string
): PatientHospitalization[] => {
    const appearances: PatientHospitalization[] = [];
    const normalizedRut = normalizeRut(rut);

    records.forEach((record, recordDate) => {
        if (!record.beds) return;

        Object.entries(record.beds).forEach(([bedId, patient]) => {
            if (!patient || !patient.rut) return;

            if (normalizeRut(patient.rut) === normalizedRut) {
                appearances.push({
                    recordDate,
                    bedId,
                    bedLabel: bedId.replace('BED_', ''),
                    diagnosis: patient.pathology || '',
                    admissionDate: patient.admissionDate || recordDate,
                    service: patient.specialty || 'No especificado',
                    patientName: patient.patientName || ''
                });
            }
        });
    });

    // Sort by date descending
    return appearances.sort((a, b) =>
        new Date(b.recordDate).getTime() - new Date(a.recordDate).getTime()
    );
};

/**
 * Create a hospitalization group from records
 */
const createGroup = (records: PatientHospitalization[]): PatientHistoryGroup => {
    const firstRecord = records[0];
    const lastRecord = records[records.length - 1];

    return {
        admissionDate: firstRecord.admissionDate || firstRecord.recordDate,
        dischargeDate: lastRecord.recordDate,
        daysStayed: records.length,
        diagnosis: firstRecord.diagnosis,
        service: firstRecord.service,
        bedId: firstRecord.bedId,
        records
    };
};

/**
 * Group consecutive records into hospitalizations.
 * Records with gaps > 7 days are considered separate hospitalizations.
 */
const groupIntoHospitalizations = (
    records: PatientHospitalization[]
): PatientHistoryGroup[] => {
    if (records.length === 0) return [];

    const groups: PatientHistoryGroup[] = [];
    let currentGroup: PatientHospitalization[] = [];

    // Sort by date ascending for grouping
    const sortedRecords = [...records].sort((a, b) =>
        new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime()
    );

    for (const record of sortedRecords) {
        if (currentGroup.length === 0) {
            currentGroup.push(record);
            continue;
        }

        const lastRecord = currentGroup[currentGroup.length - 1];
        const lastDate = new Date(lastRecord.recordDate);
        const currentDate = new Date(record.recordDate);
        const daysDiff = (currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

        // If more than 7 days gap, consider it a new hospitalization
        if (daysDiff > 7) {
            groups.push(createGroup(currentGroup));
            currentGroup = [record];
        } else {
            currentGroup.push(record);
        }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
        groups.push(createGroup(currentGroup));
    }

    // Return in reverse chronological order
    return groups.reverse();
};

/**
 * Check if hospitalization is current (includes today or yesterday)
 */
const isCurrentHospitalization = (group: PatientHistoryGroup): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastDate = new Date(group.dischargeDate || group.admissionDate);
    lastDate.setHours(0, 0, 0, 0);

    return lastDate >= yesterday;
};

// ============= Main API =============

/**
 * Get complete patient history by RUT.
 * Uses cache to avoid repeated queries.
 * 
 * @param rut - Patient's RUT (Chilean ID)
 * @returns Patient history with all hospitalizations, or null if not found
 */
export const getPatientHistory = async (rut: string): Promise<PatientHistory | null> => {
    // Check cache first
    const cached = getCachedHistory(rut);
    if (cached) return cached;

    try {
        console.log(`🔍 Searching patient history for RUT: ${rut}`);

        const allRecords = await getAllDailyRecords();
        const patientRecords = findPatientRecords(allRecords, rut);

        if (patientRecords.length === 0) {
            console.log(`No records found for RUT: ${rut}`);
            return null;
        }

        const groups = groupIntoHospitalizations(patientRecords);

        // Separate current from past
        const currentGroup = groups.find(g => isCurrentHospitalization(g));
        const pastGroups = groups.filter(g => !isCurrentHospitalization(g));

        const history: PatientHistory = {
            rut,
            name: patientRecords[0].patientName,
            currentHospitalization: currentGroup ? currentGroup.records[currentGroup.records.length - 1] : null,
            pastHospitalizations: pastGroups,
            totalHospitalizations: groups.length,
            totalDaysHospitalized: groups.reduce((sum, g) => sum + g.daysStayed, 0)
        };

        // Cache the result
        setCachedHistory(rut, history);

        console.log(`✅ Found ${history.totalHospitalizations} hospitalization(s) for ${history.name}`);
        return history;

    } catch (error) {
        console.error('Error fetching patient history:', error);
        throw error;
    }
};
