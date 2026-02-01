import type { Meta, StoryObj } from '@storybook/react';
import { SummaryCard } from '@/components/layout/SummaryCard';
import { Statistics } from '@/types';

const meta: Meta<typeof SummaryCard> = {
    title: 'Hospital/SummaryCard',
    component: SummaryCard,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper to create mock statistics
const createMockStats = (overrides: Partial<Statistics> = {}): Statistics => ({
    occupiedBeds: 10,
    occupiedCribs: 2,
    clinicalCribsCount: 3,
    companionCribs: 1,
    totalCribsUsed: 4,
    totalHospitalized: 12,
    blockedBeds: 1,
    serviceCapacity: 17,
    availableCapacity: 5,
    ...overrides,
});

/**
 * Default state with sample statistics
 */
export const Default: Story = {
    args: {
        stats: createMockStats(),
        discharges: [],
        transfers: [],
        cmaCount: 5,
    },
};

/**
 * Empty hospital - no patients
 */
export const Empty: Story = {
    args: {
        stats: createMockStats({
            occupiedBeds: 0,
            occupiedCribs: 0,
            totalHospitalized: 0,
            blockedBeds: 0,
            availableCapacity: 18,
        }),
        discharges: [],
        transfers: [],
        cmaCount: 0,
    },
};

/**
 * Full capacity - all beds occupied
 */
export const FullCapacity: Story = {
    args: {
        stats: createMockStats({
            occupiedBeds: 18,
            totalHospitalized: 18,
            availableCapacity: 0,
        }),
        discharges: [],
        transfers: [],
        cmaCount: 8,
    },
};
