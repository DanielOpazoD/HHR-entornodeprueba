/**
 * Data Maintenance Service
 * 
 * Provides functionality for manual JSON export and import of daily records.
 * This allows administrators to have local backups and restore data by month.
 */

import { DailyRecord } from '../../types';
import * as DailyRecordRepository from '../repositories/DailyRecordRepository';
import * as indexedDBService from '../storage/indexedDBService';
import { saveAs } from 'file-saver';
import { logAuditEvent } from './auditService';
import { getCurrentUserEmail } from './utils/auditUtils';

export interface MonthBackup {
    version: string;
    exportDate: string;
    year: number;
    month: number;
    recordCount: number;
    records: DailyRecord[];
}

/**
 * Exports all records for a specific month as a JSON file
 */
export const exportMonthRecords = async (year: number, month: number): Promise<void> => {
    try {
        const records = await indexedDBService.getRecordsForMonth(year, month);

        if (records.length === 0) {
            throw new Error('No hay registros para exportar en este período.');
        }

        const backup: MonthBackup = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            year,
            month,
            recordCount: records.length,
            records
        };

        const monthNames = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ];
        const monthName = monthNames[month - 1];
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const fileName = `Respaldo HHR ${monthName} ${year}.json`;
        saveAs(blob, fileName);

        // Audit log
        await logAuditEvent(
            getCurrentUserEmail(),
            'DATA_EXPORTED',
            'dailyRecord',
            `${year}-${month}`,
            { year, month, recordCount: records.length }
        );
    } catch (error) {
        console.error('Export failed:', error);
        throw error;
    }
};

/**
 * Imports records from a backup object
 * Uses the repository to ensure Firestore sync and audit logging
 */
export const importRecordsFromBackup = async (backup: MonthBackup, onProgress?: (current: number, total: number) => void): Promise<{ success: number, failed: number }> => {
    let success = 0;
    let failed = 0;

    for (let i = 0; i < backup.records.length; i++) {
        const record = backup.records[i];
        try {
            // Validate record date matches backup metadata optionally, 
            // but usually we just trust the individual record dates
            await DailyRecordRepository.save(record);
            success++;
        } catch (error) {
            console.error(`Failed to import record for ${record.date}:`, error);
            failed++;
        }

        if (onProgress) {
            onProgress(i + 1, backup.records.length);
        }
    }

    // Audit log
    if (success > 0) {
        await logAuditEvent(
            getCurrentUserEmail(),
            'DATA_IMPORTED',
            'dailyRecord',
            `${backup.year}-${backup.month}`,
            { year: backup.year, month: backup.month, recordCount: success, failedCount: failed }
        );
    }

    return { success, failed };
};

/**
 * Validates if a file is a valid HHR Backup
 */
export const validateBackupFile = (content: unknown): content is MonthBackup => {
    if (!content || typeof content !== 'object') return false;
    const data = content as Record<string, unknown>;
    return (
        typeof data.version === 'string' &&
        Array.isArray(data.records) &&
        data.records.length > 0 &&
        typeof (data.records[0] as DailyRecord).date === 'string'
    );
};
