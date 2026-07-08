import { describe, it, expect, vi } from 'vitest';
import {
  filterLogs,
  groupLogs,
  calculateAuditStats,
  parseAuditTimestamp,
} from '@/services/admin/auditWorkerLogic';
import { AuditLogEntry, WorkerFilterParams } from '@/types/auditLogTypes';
import { AUDIT_SECTIONS } from '@/services/admin/auditViewConfig';
import { buildAuditSectionActionsMap } from '@/hooks/controllers/auditDataPolicyController';

describe('AuditWorkerLogic', () => {
  const mockLogs: AuditLogEntry[] = [
    {
      id: '1',
      timestamp: '2026-01-31T10:00:00Z',
      userId: 'user@test.com',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'bed-1',
      details: { patientName: 'Juan Perez', rut: '12345678-9' },
    },
    {
      id: '2',
      timestamp: '2026-01-31T11:00:00Z',
      userId: 'user@test.com',
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: 'bed-1',
      details: { patientName: 'Juan Perez' },
    },
  ];

  const actionLabels = {
    PATIENT_ADMITTED: 'Ingreso',
    PATIENT_MODIFIED: 'Modificación',
  };

  it('should parse timestamps correctly', () => {
    expect(parseAuditTimestamp('2026-01-31').getFullYear()).toBe(2026);
    expect(parseAuditTimestamp({ seconds: 1769817600 }).getFullYear()).toBe(2026);
  });

  it('should filter logs by search term', () => {
    const params: WorkerFilterParams = {
      searchTerm: 'Juan',
      filterAction: 'ALL',
      startDate: '',
      endDate: '',
      activeSection: 'ALL',
      sectionActions: { ALL: undefined },
      groupedView: false,
    };
    const filtered = filterLogs(mockLogs, params);
    expect(filtered.length).toBe(2);
  });

  it('filters logs by legal traceability fields and clinical presentation text', () => {
    const traceLog: AuditLogEntry = {
      id: 'trace-1',
      timestamp: '2026-05-28T12:00:00Z',
      userId: 'doctor@test.com',
      userDisplayName: 'Doctor Test',
      userUid: 'uid-legal-123',
      ipAddress: '190.10.10.10',
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: 'Cama 4',
      summary: 'Movimiento de cama',
      details: {
        patientName: 'Ana Vera',
        rut: '11222333-4',
        movementKind: 'move',
        sourceBed: '4',
        targetBed: '6',
      },
    };

    const baseParams: WorkerFilterParams = {
      searchTerm: '',
      filterAction: 'ALL',
      startDate: '',
      endDate: '',
      activeSection: 'ALL',
      sectionActions: { ALL: undefined },
      groupedView: false,
    };

    const search = (searchTerm: string) => filterLogs([traceLog], { ...baseParams, searchTerm });

    expect(search('190.10.10.10')).toHaveLength(1);
    expect(search('uid-legal-123')).toHaveLength(1);
    expect(search('trasladado')).toHaveLength(1);
    expect(search('Cama 4')).toHaveLength(1);
  });

  it('keeps the clinical timeline searchable without restricting by audit action buckets', () => {
    const traceLog: AuditLogEntry = {
      id: 'timeline-1',
      timestamp: '2026-05-28T12:00:00Z',
      userId: 'doctor@test.com',
      userDisplayName: 'Doctor Test',
      ipAddress: '190.10.10.10',
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: 'Cama 4',
      details: {
        patientName: 'Ana Vera',
        rut: '11222333-4',
        movementKind: 'move',
        sourceBed: '4',
        targetBed: '6',
      },
    };

    const params: WorkerFilterParams = {
      searchTerm: 'trasladado',
      filterAction: 'ALL',
      startDate: '',
      endDate: '',
      activeSection: 'TIMELINE',
      sectionActions: { TIMELINE: [] },
      groupedView: false,
    };

    const filtered = filterLogs([traceLog], params);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('timeline-1');
  });

  it('keeps fine-grained daily census events visible in the census section', () => {
    const censusLogs: AuditLogEntry[] = [
      {
        id: 'diagnosis-1',
        timestamp: '2026-07-01T12:00:00Z',
        userId: 'doctor@test.com',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        entityType: 'patient',
        entityId: 'H4C1',
        details: { patientName: 'Ana Vera', changes: { diagnosis: { old: '', new: 'ICC' } } },
      },
      {
        id: 'bed-1',
        timestamp: '2026-07-01T12:01:00Z',
        userId: 'doctor@test.com',
        action: 'PATIENT_BED_CHANGED',
        entityType: 'patient',
        entityId: 'H4C2',
        details: {
          patientName: 'Ana Vera',
          movementKind: 'move',
          sourceBed: 'H4C1',
          targetBed: 'H4C2',
        },
      },
      {
        id: 'conflict-1',
        timestamp: '2026-07-01T12:02:00Z',
        userId: 'doctor@test.com',
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: { patientName: 'Ana Vera', changedPaths: ['beds.H4C2', 'discharges'] },
      },
      {
        id: 'login-1',
        timestamp: '2026-07-01T12:03:00Z',
        userId: 'doctor@test.com',
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: 'doctor@test.com',
        details: {},
      },
    ];

    const filtered = filterLogs(censusLogs, {
      searchTerm: '',
      filterAction: 'ALL',
      startDate: '',
      endDate: '',
      activeSection: 'CENSUS',
      sectionActions: buildAuditSectionActionsMap(AUDIT_SECTIONS),
      groupedView: false,
    });

    expect(filtered.map(log => log.id)).toEqual(['diagnosis-1', 'bed-1', 'conflict-1']);
  });

  it('should filter logs by action', () => {
    const params: WorkerFilterParams = {
      searchTerm: '',
      filterAction: 'PATIENT_ADMITTED',
      startDate: '',
      endDate: '',
      activeSection: 'ALL',
      sectionActions: { ALL: undefined },
      groupedView: false,
    };
    const filtered = filterLogs(mockLogs, params);
    expect(filtered.length).toBe(1);
    expect(filtered[0].action).toBe('PATIENT_ADMITTED');
  });

  it('should group repeated logs inside a ten minute burst without crossing the burst window', () => {
    const display = groupLogs(mockLogs, actionLabels);
    // They are separate because actions are different
    expect(display.length).toBe(2);

    const similarLogs: AuditLogEntry[] = [
      { ...mockLogs[1], id: '3', timestamp: '2026-01-31T12:00:00Z' },
      { ...mockLogs[1], id: '4', timestamp: '2026-01-31T12:09:59Z' },
      { ...mockLogs[1], id: '5', timestamp: '2026-01-31T12:10:01Z' },
    ];
    const grouped = groupLogs(similarLogs, actionLabels);
    expect(grouped.length).toBe(2);
    expect(grouped.some(log => (log as unknown as { isGroup?: boolean }).isGroup)).toBe(true);
  });

  it('groups same action, user and IP inside ten minutes even when entity ids differ', () => {
    const errorLogs: AuditLogEntry[] = [
      {
        id: 'err-1',
        timestamp: '2026-05-02T12:22:09.000Z',
        userId: 'doctor@test.com',
        userDisplayName: 'Doctor Test',
        ipAddress: '138.84.83.116',
        action: 'SYSTEM_ERROR',
        entityType: 'system',
        entityId: 'err-1',
        summary: 'Error del Sistema',
        details: { message: 'sync failed' },
      },
      {
        id: 'err-2',
        timestamp: '2026-05-02T12:31:59.000Z',
        userId: 'doctor@test.com',
        userDisplayName: 'Doctor Test',
        ipAddress: '138.84.83.116',
        action: 'SYSTEM_ERROR',
        entityType: 'system',
        entityId: 'err-2',
        summary: 'Error del Sistema',
        details: { message: 'sync failed' },
      },
    ];

    const grouped = groupLogs(errorLogs, { SYSTEM_ERROR: 'Error del Sistema' });

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual(
      expect.objectContaining({
        isGroup: true,
        summary: 'Error del Sistema (2 registros en 10 min)',
      })
    );
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
