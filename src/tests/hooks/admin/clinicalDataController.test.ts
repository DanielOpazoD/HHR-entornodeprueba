import { describe, expect, it } from 'vitest';
import type { AuditLogEntry } from '@/types/audit';
import { buildClinicalData } from '@/hooks/admin/clinicalDataController';

const createLog = (
    id: string,
    timestamp: string,
    details: AuditLogEntry['details']
): AuditLogEntry => ({
    id,
    timestamp,
    userId: 'user@hospital.cl',
    action: 'PATIENT_MODIFIED',
    entityType: 'patient',
    entityId: 'R1',
    details,
});

describe('clinicalDataController', () => {
    it('returns empty data when search RUT is missing', () => {
        const result = buildClinicalData('', [], [], []);

        expect(result.bedHistory).toEqual([]);
        expect(result.totalUpcDays).toBe(0);
        expect(result.diagnosisHistory).toEqual([]);
        expect(result.devicesHistory).toEqual([]);
    });

    it('builds bed/upc/diagnosis/device histories in reverse chronological order', () => {
        const logs: AuditLogEntry[] = [
            createLog('1', '2025-01-01T08:00:00.000Z', {
                bedId: 'R1',
                pathology: 'Neumonía',
            }),
            createLog('2', '2025-01-02T08:00:00.000Z', {
                changes: { isUPC: { old: false, new: true } },
            }),
            createLog('3', '2025-01-03T08:00:00.000Z', {
                bedId: 'R2',
                changes: {
                    pathology: { old: 'Neumonía', new: 'Neumonía grave' },
                    deviceDetails: { CVC: { old: null, new: 'installed' } },
                } as unknown as AuditLogEntry['details']['changes'],
            }),
            createLog('4', '2025-01-04T08:00:00.000Z', {
                changes: {
                    isUPC: { old: true, new: false },
                    deviceDetails: { CVC: { old: 'installed', new: null } },
                } as unknown as AuditLogEntry['details']['changes'],
            }),
        ];

        const admissions = [createLog('A1', '2025-01-01T08:00:00.000Z', { bedId: 'R1' })];
        const discharges = [createLog('D1', '2025-01-05T08:00:00.000Z', { bedId: 'R2' })];

        const result = buildClinicalData('12.345.678-9', logs, admissions, discharges);

        expect(result.bedHistory).toHaveLength(2);
        expect(result.bedHistory[0]?.bedId).toBe('R2');
        expect(result.bedHistory[1]?.bedId).toBe('R1');
        expect(result.totalUpcDays).toBe(2);

        expect(result.diagnosisHistory).toHaveLength(2);
        expect(result.diagnosisHistory[0]?.pathology).toBe('Neumonía grave');
        expect(result.diagnosisHistory[1]?.pathology).toBe('Neumonía');

        expect(result.devicesHistory).toHaveLength(2);
        expect(result.devicesHistory[0]?.action).toBe('REMOVE');
        expect(result.devicesHistory[1]?.action).toBe('INSTALL');
        expect(result.firstAdmission).toBe('2025-01-01T08:00:00.000Z');
        expect(result.lastDischarge).toBe('2025-01-05T08:00:00.000Z');
    });
});
