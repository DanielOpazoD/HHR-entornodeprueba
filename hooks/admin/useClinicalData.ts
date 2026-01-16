import { useMemo } from 'react';
import { AuditLogEntry } from '../../types/audit';

export interface ClinicalData {
    bedHistory: { bedId: string, from: Date, to: Date | null, days: number }[];
    totalUpcDays: number;
    diagnosisHistory: { date: Date, pathology: string }[];
    devicesHistory: { date: Date, name: string, action: 'INSTALL' | 'REMOVE', details: string }[];
    firstAdmission?: string;
    lastDischarge?: string;
}

/**
 * Hook to process audit logs and extract clinical milestones, bed history, 
 * and invasive device usage for a specific patient.
 */
export const useClinicalData = (
    searchRut: string,
    chronologicalLogs: AuditLogEntry[],
    admissions: AuditLogEntry[],
    discharges: AuditLogEntry[]
): ClinicalData => {
    return useMemo(() => {
        const bedHistory: { bedId: string, from: Date, to: Date | null, days: number }[] = [];
        let totalUpcMs = 0;
        const diagnosisHistory: { date: Date, pathology: string }[] = [];
        const devicesHistory: { date: Date, name: string, action: 'INSTALL' | 'REMOVE', details: string }[] = [];

        if (!searchRut || chronologicalLogs.length === 0) {
            return {
                bedHistory: [],
                totalUpcDays: 0,
                diagnosisHistory: [],
                devicesHistory: [],
                firstAdmission: undefined,
                lastDischarge: undefined
            };
        }

        // Track current state during iteration
        let currentBed: string | null = null;
        let lastBedChange: Date | null = null;
        let isCurrentlyUpc = false;
        let lastUpcChange: Date | null = null;

        chronologicalLogs.forEach((log) => {
            const timestamp = new Date(log.timestamp);
            const details = log.details;

            // 1. Bed tracking
            const logBedId = details?.bedId;
            if (logBedId && logBedId !== currentBed) {
                if (currentBed && lastBedChange) {
                    const duration = timestamp.getTime() - lastBedChange.getTime();
                    bedHistory.push({
                        bedId: currentBed,
                        from: lastBedChange,
                        to: timestamp,
                        days: Math.max(1, Math.ceil(duration / (1000 * 60 * 60 * 24)))
                    });
                }
                currentBed = logBedId;
                lastBedChange = timestamp;
            }

            // 2. UPC tracking (clinicalFlags.isUPC or isUPC)
            const upcNew = details?.changes?.isUPC?.new ?? details?.changes?.["clinicalFlags.isUPC"]?.new ?? details?.isUPC;
            if (upcNew !== undefined && upcNew !== isCurrentlyUpc) {
                if (isCurrentlyUpc && lastUpcChange) {
                    totalUpcMs += timestamp.getTime() - lastUpcChange.getTime();
                }
                isCurrentlyUpc = !!upcNew;
                lastUpcChange = timestamp;
            }

            // 3. Diagnosis evolution
            const pathology = (details?.changes?.pathology?.new || details?.pathology) as string | undefined;
            if (pathology) {
                diagnosisHistory.push({ date: timestamp, pathology });
            }

            // 4. Invasive devices
            if (details?.changes?.deviceDetails) {
                Object.entries(details.changes.deviceDetails).forEach(([name, delta]: [string, any]) => {
                    devicesHistory.push({
                        date: timestamp,
                        name,
                        action: delta.new ? 'INSTALL' : 'REMOVE',
                        details: delta.new?.installationDate ? `Instalado el ${delta.new.installationDate}` : 'Retirado'
                    });
                });
            }
        });

        // Close last bed
        if (currentBed && lastBedChange) {
            const lastLog = discharges[discharges.length - 1];
            const end = (discharges.length > 0 && lastLog) ? new Date(lastLog.timestamp) : new Date();
            const duration = end.getTime() - (lastBedChange as Date).getTime();
            bedHistory.push({
                bedId: currentBed,
                from: lastBedChange,
                to: discharges.length > 0 ? end : null,
                days: Math.max(1, Math.ceil(duration / (1000 * 60 * 60 * 24)))
            });
        }

        // Close last UPC period
        if (isCurrentlyUpc && lastUpcChange) {
            const lastLog = discharges[discharges.length - 1];
            const end = (discharges.length > 0 && lastLog) ? new Date(lastLog.timestamp) : new Date();
            totalUpcMs += end.getTime() - (lastUpcChange as Date).getTime();
        }

        return {
            bedHistory: bedHistory.reverse(),
            totalUpcDays: Math.ceil(totalUpcMs / (1000 * 60 * 60 * 24)),
            diagnosisHistory: diagnosisHistory.reverse(),
            devicesHistory: devicesHistory.reverse(),
            firstAdmission: admissions[0]?.timestamp,
            lastDischarge: discharges[discharges.length - 1]?.timestamp
        };
    }, [searchRut, chronologicalLogs, admissions, discharges]);
};
