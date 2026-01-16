import { AuditLogEntry } from '../types/audit';

export const createMockAuditLog = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
    id: `log-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId: 'doctor@example.com',
    userDisplayName: 'Dr. Smith',
    action: 'PATIENT_ADMITTED',
    entityType: 'patient',
    entityId: 'bed-1',
    details: {
        patientName: 'Juan Pérez',
        bedId: '101',
        pathology: 'Neumonía',
        rut: '12.345.678-9'
    },
    ipAddress: '192.168.1.1',
    recordDate: '2026-01-11',
    ...overrides,
});

export const createMockAuditStats = () => ({
    todayCount: 156,
    activeUserCount: 12,
    criticalCount: 5,
    avgSessionMinutes: 45,
    totalSessionsToday: 24,
    actionBreakdown: {
        'PATIENT_ADMITTED': 45,
        'PATIENT_DISCHARGED': 38,
        'CUDYR_MODIFIED': 120,
        'USER_LOGIN': 24,
        'SYSTEM_ERROR': 2
    }
});
