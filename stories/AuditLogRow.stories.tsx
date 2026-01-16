import type { Meta, StoryObj } from '@storybook/react';
import { AuditLogRow } from '../views/admin/components/audit/AuditLogRow';
import { createMockAuditLog } from './auditMocks';

const meta: Meta<typeof AuditLogRow> = {
    title: 'Audit/AuditLogRow',
    component: AuditLogRow,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <table className="w-full">
                <tbody>
                    <Story />
                </tbody>
            </table>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        log: createMockAuditLog(),
        isExpanded: false,
        onToggle: () => console.log('Toggle'),
    },
};

export const Expanded: Story = {
    args: {
        ...Default.args,
        isExpanded: true,
    },
};

export const WithChanges: Story = {
    args: {
        ...Default.args,
        log: createMockAuditLog({
            action: 'NURSE_HANDOFF_MODIFIED',
            details: {
                patientName: 'Juan Pérez',
                changes: {
                    note: { old: 'Paciente estable', new: 'Paciente con fiebre, requiere monitoreo' }
                }
            }
        }),
        isExpanded: true,
    },
};

export const Compact: Story = {
    args: {
        ...Default.args,
        compactView: true,
    },
};

export const Grouped: Story = {
    args: {
        ...Default.args,
        log: {
            ...createMockAuditLog(),
            isGroup: true,
            childLogs: [
                createMockAuditLog({ id: 'child-1', summary: 'Cambio en campo A' }),
                createMockAuditLog({ id: 'child-2', summary: 'Cambio en campo B' }),
            ]
        } as any,
        isExpanded: true,
    },
};
