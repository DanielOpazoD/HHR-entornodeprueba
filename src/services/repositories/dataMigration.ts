/**
 * Data Migration Service
 * Handles migration of legacy data formats to current schema.
 * 
 * Clinical Justification: Ensures that clinical data recorded in older versions
 * of the app remains consistent and usable for audits, even as data structures evolve.
 * Prevents "silent corruption" of historical patient records.
 */

import { DailyRecord } from '@/types';
import { parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';

/**
 * Migrates legacy data formats to the current schema using Zod for robust validation.
 * 
 * @param record - The record to migrate (potentially in legacy format)
 * @param date - The date string for the record
 * @returns Fully migrated and validated DailyRecord
 */
export const migrateLegacyData = (record: DailyRecord, date: string): DailyRecord => {
    // 1. Initial pass through Zod to apply defaults and recover basic structure
    let migrated = parseDailyRecordWithDefaults(record, date);

    // 1.5. Apply Invariants (Ensure all beds BED_01 to BED_25 exist)
    // This is CRITICAL to prevent the "Desert of Data" where beds disappear
    // if they were not present in the stored document.
    const normalized = normalizeDailyRecordInvariants(migrated);
    migrated = normalized.record;

    // 2. Custom Business Migrations 

    // --- NURSES MIGRATION ---
    // Legacy Nurses Array: If nursesDayShift is empty but legacy 'nurses' has data, migrate it.
    if (migrated.nurses && migrated.nurses.length > 0) {
        const hasNurses = migrated.nurses.some(n => !!n);
        const isDayShiftEmpty = !migrated.nursesDayShift || migrated.nursesDayShift.every(n => !n);

        if (hasNurses && isDayShiftEmpty) {
            migrated.nursesDayShift = [...migrated.nurses];
        }
    }

    // Legacy NurseName: Legacy single string migration
    if (migrated.nurseName && (!migrated.nursesDayShift || !migrated.nursesDayShift[0])) {
        if (!migrated.nursesDayShift) migrated.nursesDayShift = ["", ""];
        migrated.nursesDayShift[0] = migrated.nurseName;
    }

    // --- TENS MIGRATION ---
    // Custom check for legacy 'tens' which might exist in raw record but not in DailyRecord type
    const rawTens = (record as unknown as { tens?: string[] }).tens;
    if (Array.isArray(rawTens) && rawTens.length > 0) {
        const hasTens = rawTens.some(t => !!t);
        const isDayTensEmpty = !migrated.tensDayShift || migrated.tensDayShift.every(t => !t);

        if (hasTens && isDayTensEmpty) {
            // Ensure we pad/slice to match current schema (3 TENS)
            const paddedTens = [...rawTens];
            while (paddedTens.length < 3) paddedTens.push('');
            migrated.tensDayShift = paddedTens.slice(0, 3);
        }
    }

    // --- NIGHT SHIFT FALLBACK ---
    // In some cases, if Day Shift is empty but record has Night Shift notes, 
    // we might want to ensure they are at least initialized to arrays if they aren't already.
    // (Zod defaults handles this, so we focus on data movement).

    // Ensure schemaVersion is at least 1
    migrated.schemaVersion = Math.max(migrated.schemaVersion || 0, 1);

    return migrated;
};
