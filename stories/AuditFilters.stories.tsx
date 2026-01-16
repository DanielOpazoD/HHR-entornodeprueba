import type { Meta, StoryObj } from '@storybook/react';
import { AuditFilters } from '../views/admin/components/audit/AuditFilters';

const meta: Meta<typeof AuditFilters> = {
    title: 'Audit/AuditFilters',
    component: AuditFilters,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        searchTerm: '',
        onSearchChange: (v) => console.log('Search:', v),
        searchRut: '',
        onSearchRutChange: (v) => console.log('RUT:', v),
        filterAction: 'ALL',
        onFilterActionChange: (v) => console.log('Action:', v),
        startDate: '2026-01-01',
        onStartDateChange: (v) => console.log('Start Date:', v),
        endDate: '2026-01-11',
        onEndDateChange: (v) => console.log('End Date:', v),
    },
};

export const WithFilters: Story = {
    args: {
        ...Default.args,
        searchTerm: 'Juan Perez',
        filterAction: 'PATIENT_ADMITTED',
    },
};

export const TraceabilityFocus: Story = {
    args: {
        ...Default.args,
        searchRut: '12.345.678-9',
        onFocusTraceability: () => console.log('Focus Traceability'),
    },
};
