import type { Meta, StoryObj } from '@storybook/react';
import { AuditHeader } from '../views/admin/components/audit/AuditHeader';

const meta: Meta<typeof AuditHeader> = {
    title: 'Audit/AuditHeader',
    component: AuditHeader,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        onShowCompliance: () => console.log('Show Compliance'),
        onExport: () => console.log('Export'),
        onRefresh: () => console.log('Refresh'),
        isExporting: false,
        isLoading: false,
        hasLogs: true,
        isAdmin: false
    },
};

export const AdminView: Story = {
    args: {
        ...Default.args,
        isAdmin: true,
        onConsolidate: () => console.log('Consolidate'),
    },
};

export const Loading: Story = {
    args: {
        ...Default.args,
        isLoading: true,
    },
};

export const Exporting: Story = {
    args: {
        ...Default.args,
        isExporting: true,
    },
};

export const Empty: Story = {
    args: {
        ...Default.args,
        hasLogs: false,
    },
};
