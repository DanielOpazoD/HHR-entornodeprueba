import type { Meta, StoryObj } from '@storybook/react';
import { AuditTable } from '../views/admin/components/audit/AuditTable';
import { createMockAuditLog } from './auditMocks';

const meta: Meta<typeof AuditTable> = {
    title: 'Audit/AuditTable',
    component: AuditTable,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockLogs = Array.from({ length: 15 }).map((_, i) => createMockAuditLog({
    id: `log-${i}`,
    action: i % 2 === 0 ? 'PATIENT_ADMITTED' : 'CUDYR_MODIFIED'
}));

export const Default: Story = {
    args: {
        filteredLogs: mockLogs,
        paginatedLogs: mockLogs.slice(0, 10),
        loading: false,
        compactView: false,
        setCompactView: (v) => console.log('Compact:', v),
        groupedView: false,
        setGroupedView: (v) => console.log('Grouped:', v),
        expandedRows: new Set(),
        toggleRow: (id) => console.log('Toggle:', id),
        onPdfExport: () => console.log('PDF Export'),
        onExcelExport: () => console.log('Excel Export'),
        isExporting: false,
        currentPage: 1,
        totalPages: 2,
        onPageChange: (p) => console.log('Page:', p),
        itemsPerPage: 10
    },
};

export const Compact: Story = {
    args: {
        ...Default.args,
        compactView: true,
    },
};

export const Loading: Story = {
    args: {
        ...Default.args,
        loading: true,
        paginatedLogs: [],
    },
};

export const Empty: Story = {
    args: {
        ...Default.args,
        filteredLogs: [],
        paginatedLogs: [],
    },
};
