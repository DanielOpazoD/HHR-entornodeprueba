import { DailyRecord } from '../types';

/**
 * Error thrown when a significant loss of data is detected during a save operation.
 */
export class DataRegressionError extends Error {
    constructor(
        message: string,
        public localDensity: number,
        public remoteDensity: number
    ) {
        super(message);
        this.name = 'DataRegressionError';
    }
}

/**
 * Error thrown when a record in the cloud has a newer schema version than the local app.
 */
export class VersionMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VersionMismatchError';
    }
}

/**
 * Calculates a "density score" for a daily record.
 * This is a heuristic metric representing how much clinical data the record contains.
 */
export const calculateDensity = (record: DailyRecord | null | undefined): number => {
    if (!record) return 0;

    let score = 0;

    // 1. Bed Occupancy (major weight)
    const activeBeds = Object.values(record.beds || {}).filter(b => b && (b.patientName || b.isBlocked));
    score += activeBeds.length * 10;

    // 2. Clinical details weight
    activeBeds.forEach(bed => {
        if (bed.diagnosisComments) score += 2;
        if (bed.handoffNote) score += 5;
        if (bed.handoffNoteDayShift) score += 3;
        if (bed.handoffNoteNightShift) score += 3;
        if (bed.cudyr) score += 5;
        if (bed.clinicalCrib && (bed.clinicalCrib.patientName || bed.clinicalCrib.isBlocked)) {
            score += 10;
        }
    });

    // 3. Documented movements
    score += (record.discharges?.length || 0) * 8;
    score += (record.transfers?.length || 0) * 8;
    score += (record.cma?.length || 0) * 5;

    // 4. Staffing
    const staffArrays = [
        record.nursesDayShift,
        record.nursesNightShift,
        record.tensDayShift,
        record.tensNightShift
    ];
    staffArrays.forEach(arr => {
        if (Array.isArray(arr)) {
            score += arr.filter(name => name && name.trim().length > 0).length * 2;
        }
    });

    // 5. Handoff context
    if (record.handoffNovedadesDayShift) score += 10;
    if (record.handoffNovedadesNightShift) score += 10;
    if (record.medicalHandoffNovedades) score += 10;

    return score;
};

/**
 * Checks if a new record version is a suspicious regression compared to an old one.
 * 
 * Logic:
 * If the old record was substantial (density > 20) and the new record is significantly
 * less dense (regression > 40%), it's considered suspicious.
 * 
 * Exceptions:
 * - If the old record was nearly empty (density < 10).
 * - Total wipes are always suspicious if old record was full.
 */
export const checkRegression = (
    oldRecord: DailyRecord | null | undefined,
    newRecord: DailyRecord
): { isSuspicious: boolean; dropPercentage: number } => {
    if (!oldRecord) return { isSuspicious: false, dropPercentage: 0 };

    const oldDensity = calculateDensity(oldRecord);
    const newDensity = calculateDensity(newRecord);

    // If remote is basically empty, no risk of regression
    if (oldDensity < 10) return { isSuspicious: false, dropPercentage: 0 };

    const drop = oldDensity - newDensity;
    const dropPercentage = (drop / oldDensity) * 100;

    // Thresholds:
    // 1. If we lose more than 40% of data density, it's a regression
    // 2. If we lose more than 5 beds worth of data (50 density points)
    const isSuspicious = dropPercentage > 40 || drop > 50;

    return { isSuspicious, dropPercentage };
};
