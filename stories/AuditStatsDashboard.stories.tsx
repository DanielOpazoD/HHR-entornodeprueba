import type { Meta, StoryObj } from '@storybook/react';
import { AuditStatsDashboard } from '../views/admin/components/audit/AuditStatsDashboard';
import { createMockAuditLog, createMockAuditStats } from './auditMocks';

const meta: Meta<typeof AuditStatsDashboard> = {
    title: 'Audit/AuditStatsDashboard',
    component: AuditStatsDashboard,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockLogs = Array.from({ length: 50 }).map((_, _i) => createMockAuditLog());

export const Default: Story = {
    args: {
        stats: createMockAuditStats(),
        logs: mockLogs,
    },
};

export const HighCriticity: Story = {
    args: {
        stats: {
            ...createMockAuditStats(),
            criticalCount: 25,
            actionBreakdown: {
                'SYSTEM_ERROR': 15,
                'PATIENT_DELETED': 10,
                'USER_LOGIN': 5
            }
        },
        logs: mockLogs,
    },
};

export const Empty: Story = {
    args: {
        stats: {
            todayCount: 0,
            activeUserCount: 0,
            criticalCount: 0,
            avgSessionMinutes: 0,
            totalSessionsToday: 0,
            actionBreakdown: {}
        },
        logs: [],
    },
};
