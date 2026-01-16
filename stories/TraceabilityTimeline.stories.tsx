import type { Meta, StoryObj } from '@storybook/react';
import { TraceabilityTimeline } from '../views/admin/components/audit/TraceabilityTimeline';
import { createMockAuditLog } from './auditMocks';

const meta: Meta<typeof TraceabilityTimeline> = {
    title: 'Audit/TraceabilityTimeline',
    component: TraceabilityTimeline,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockLogs = [
    createMockAuditLog({ action: 'PATIENT_ADMITTED', timestamp: '2026-01-01T10:00:00Z', summary: 'Ingreso a Cama 101' }),
    createMockAuditLog({ action: 'CUDYR_MODIFIED', timestamp: '2026-01-02T15:30:00Z', summary: 'Evaluación CUDYR: A1 -> A2' }),
    createMockAuditLog({ action: 'PATIENT_TRANSFERRED', timestamp: '2026-01-05T09:15:00Z', summary: 'Traslado a Cama 202' }),
    createMockAuditLog({ action: 'PATIENT_DISCHARGED', timestamp: '2026-01-10T18:00:00Z', summary: 'Alta hospitalaria' }),
];

export const Default: Story = {
    args: {
        chronologicalLogs: mockLogs,
    },
};

export const SingleEvent: Story = {
    args: {
        chronologicalLogs: [mockLogs[0]],
    },
};

export const Empty: Story = {
    args: {
        chronologicalLogs: [],
    },
};
