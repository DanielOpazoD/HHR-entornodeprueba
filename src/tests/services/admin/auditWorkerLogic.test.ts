import { describe, it, expect, vi } from 'vitest';
import { filterLogs, groupLogs, calculateAuditStats, parseAuditTimestamp } from '@/services/admin/auditWorkerLogic';
import { AuditLogEntry, WorkerFilterParams } from '@/types/audit';

describe('AuditWorkerLogic', () => {
    const mockLogs: AuditLogEntry[] = [
        {
            id: '1',
            timestamp: '2026-01-31T10:00:00Z',
            userId: 'user@test.com',
            action: 'PATIENT_ADMITTED',
            entityType: 'patient',
            entityId: 'bed-1',
            details: { patientName: 'Juan Perez', rut: '12345678-9' }
        },
        {
            id: '2',
            timestamp: '2026-01-31T11:00:00Z',
            userId: 'user@test.com',
            action: 'PATIENT_MODIFIED',
            entityType: 'patient',
            entityId: 'bed-1',
            details: { patientName: 'Juan Perez' }
        }
    ];

    const actionLabels = {
        'PATIENT_ADMITTED': 'Ingreso',
        'PATIENT_MODIFIED': 'Modificación'
    };

    it('should parse timestamps correctly', () => {
        expect(parseAuditTimestamp('2026-01-31').getFullYear()).toBe(2026);
        expect(parseAuditTimestamp({ seconds: 1769817600 }).getFullYear()).toBe(2026);
    });

    it('should filter logs by search term', () => {
        const params: WorkerFilterParams = {
            searchTerm: 'Juan',
            searchRut: '',
            filterAction: 'ALL',
            startDate: '',
            endDate: '',
            activeSection: 'ALL',
            sectionActions: { 'ALL': undefined }
        };
        const filtered = filterLogs(mockLogs, params);
        expect(filtered.length).toBe(2);
    });

    it('should filter logs by action', () => {
        const params: WorkerFilterParams = {
            searchTerm: '',
            searchRut: '',
            filterAction: 'PATIENT_ADMITTED',
            startDate: '',
            endDate: '',
            activeSection: 'ALL',
            sectionActions: { 'ALL': undefined }
        };
        const filtered = filterLogs(mockLogs, params);
        expect(filtered.length).toBe(1);
        expect(filtered[0].action).toBe('PATIENT_ADMITTED');
    });

    it('should group logs correctly', () => {
        // Grouping by user/action/entity/date
        const display = groupLogs(mockLogs, actionLabels);
        // They are separate because actions are different
        expect(display.length).toBe(2);

        const similarLogs: AuditLogEntry[] = [
            { ...mockLogs[1], id: '3', timestamp: '2026-01-31T12:00:00Z' },
            { ...mockLogs[1], id: '4', timestamp: '2026-01-31T13:00:00Z' }
        ];
        const grouped = groupLogs(similarLogs, actionLabels);
        expect(grouped.length).toBe(1);
        expect((grouped[0] as any).isGroup).toBe(true);
    });

    it('should calculate stats correctly', () => {
        // Mock system time to match log date (2026-01-31)
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-31T12:00:00Z'));

        const stats = calculateAuditStats(mockLogs, ['PATIENT_ADMITTED']);
        expect(stats.todayCount).toBe(2);
        expect(stats.criticalCount).toBe(1);
        expect(stats.activeUserCount).toBe(1);

        vi.useRealTimers();
    });
});
