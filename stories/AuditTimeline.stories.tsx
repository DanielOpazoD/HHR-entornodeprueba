import type { Meta, StoryObj } from '@storybook/react';
import { AuditTimeline } from '../views/admin/components/audit/AuditTimeline';
import { createMockAuditLog } from './auditMocks';

const meta: Meta<typeof AuditTimeline> = {
    title: 'Audit/AuditTimeline',
    component: AuditTimeline,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockLogs = [
    ...Array.from({ length: 5 }).map((_, i) => createMockAuditLog({
        userId: 'doctor@hhr.cl',
        userDisplayName: 'Dr. House',
        timestamp: new Date(Date.now() - i * 1000 * 60).toISOString(),
        action: i === 4 ? 'USER_LOGIN' : 'CUDYR_MODIFIED'
    })),
    ...Array.from({ length: 3 }).map((_, i) => createMockAuditLog({
        userId: 'nurse@hhr.cl',
        userDisplayName: 'Nurse Jackie',
        timestamp: new Date(Date.now() - i * 1000 * 60 * 5).toISOString(),
        action: i === 2 ? 'USER_LOGIN' : 'PATIENT_ADMITTED'
    }))
];

export const Default: Story = {
    args: {
        logs: mockLogs,
    },
};

export const SingleUser: Story = {
    args: {
        logs: mockLogs.filter(l => l.userId === 'doctor@hhr.cl'),
    },
};

export const Empty: Story = {
    args: {
        logs: [],
    },
};
