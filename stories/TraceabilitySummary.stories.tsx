import type { Meta, StoryObj } from '@storybook/react';
import { TraceabilitySummary } from '../views/admin/components/audit/TraceabilitySummary';

const meta: Meta<typeof TraceabilitySummary> = {
    title: 'Audit/TraceabilitySummary',
    component: TraceabilitySummary,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockClinicalData = {
    firstAdmission: '2026-01-01',
    lastDischarge: undefined,
    totalUpcDays: 10,
    bedHistory: [
        { bedId: '101', from: new Date('2026-01-01'), to: new Date('2026-01-05'), days: 4 },
        { bedId: '202', from: new Date('2026-01-05'), to: null, days: 6 },
    ],
    diagnosisHistory: [
        { date: new Date('2026-01-01'), pathology: 'Insuficiencia Respiratoria' },
        { date: new Date('2026-01-06'), pathology: 'Neumonía Bacteriana' },
    ],
    devicesHistory: [
        { date: new Date('2026-01-02'), name: 'Vía Central', action: 'INSTALL' as const, details: 'Yugular derecha' },
        { date: new Date('2026-01-04'), name: 'Sonda Foley', action: 'INSTALL' as const, details: 'Silicona' },
    ],
};

export const Default: Story = {
    args: {
        clinicalData: mockClinicalData,
    },
};

export const Discharged: Story = {
    args: {
        clinicalData: {
            ...mockClinicalData,
            lastDischarge: '2026-01-11',
            bedHistory: [
                { bedId: '101', from: new Date('2026-01-01'), to: new Date('2026-01-11'), days: 10 },
            ],
        },
    },
};

export const NoDevices: Story = {
    args: {
        clinicalData: {
            ...mockClinicalData,
            devicesHistory: [],
        },
    },
};
