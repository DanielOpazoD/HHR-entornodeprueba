import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditStatsDashboard } from '@/views/admin/components/audit/AuditStatsDashboard';
import { AuditLogEntry, AuditAction } from '@/types/audit';

vi.unmock('@/services/admin/auditService');
vi.unmock('@/hooks/useAuditStats');

describe('AuditStatsDashboard', () => {
    const mockStats = {
        todayCount: 150,
        activeUserCount: 12,
        criticalCount: 5,
        avgSessionMinutes: 45,
        totalSessionsToday: 20,
        actionBreakdown: {
            'PATIENT_ADMITTED': 20,
            'PATIENT_DISCHARGED': 15,
            'DAILY_RECORD_DELETED': 5,
            'USER_LOGIN': 110
        }
    };

    const mockLogs: AuditLogEntry[] = Array(150).fill({
        id: '1',
        action: 'USER_LOGIN',
        timestamp: new Date().toISOString(),
        userId: 'u1',
        details: {}
    });

    it('should render all stat cards with correct values', () => {
        render(<AuditStatsDashboard stats={mockStats} logs={mockLogs} />);

        expect(screen.getByText('150')).toBeInTheDocument();
        expect(screen.getByText('Eventos registrados')).toBeInTheDocument();

        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('Usuarios activos hoy')).toBeInTheDocument();

        // Use getAllByText for '5' since it appears in both critical count and breakdown
        expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Acciones críticas hoy')).toBeInTheDocument();
        expect(screen.getByText('Importante')).toBeInTheDocument();
    });

    it('should format avg session duration correctly', () => {
        const statsWithTime = { ...mockStats, avgSessionMinutes: 130 };
        render(<AuditStatsDashboard stats={statsWithTime} logs={mockLogs} />);

        // 130m = 2h 10m
        expect(screen.getByText('2h 10m')).toBeInTheDocument();
    });

    it('should handle zero stats gracefully', () => {
        const zeroStats = {
            todayCount: 0,
            activeUserCount: 0,
            criticalCount: 0,
            avgSessionMinutes: 0,
            totalSessionsToday: 0,
            actionBreakdown: {}
        };
        render(<AuditStatsDashboard stats={zeroStats} logs={[]} />);

        expect(screen.getByText('-')).toBeInTheDocument(); // Avg duration placeholder
        expect(screen.queryByText('Importante')).not.toBeInTheDocument();
    });

    it('should render action breakdown list', () => {
        render(<AuditStatsDashboard stats={mockStats} logs={mockLogs} />);

        expect(screen.getByText('Desglose por Tipo')).toBeInTheDocument();
        expect(screen.getByText('Ingreso de Paciente')).toBeInTheDocument();
        expect(screen.getByText('Alta de Paciente')).toBeInTheDocument();
        expect(screen.getByText('Eliminación de Registro')).toBeInTheDocument();

        // Check counts
        expect(screen.getByText('20')).toBeInTheDocument();
        expect(screen.getByText('110')).toBeInTheDocument();
    });
});
