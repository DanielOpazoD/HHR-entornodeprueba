import { useMemo } from 'react';
import { AuditLogEntry } from '@/types/audit';
import { buildClinicalData, type ClinicalData } from './clinicalDataController';
export type { ClinicalData } from './clinicalDataController';

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
    return useMemo(
        () => buildClinicalData(searchRut, chronologicalLogs, admissions, discharges),
        [searchRut, chronologicalLogs, admissions, discharges]
    );
};
