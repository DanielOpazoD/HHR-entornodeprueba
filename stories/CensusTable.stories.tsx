import type { Meta, StoryObj } from '@storybook/react';
import { CensusTable } from '../views/census/CensusTable';
import { createMockDailyRecord } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof CensusTable> = {
    title: 'Census/CensusTable',
    component: CensusTable,
    decorators: [
        (Story) => (
            <StoryContextWrapper record={mockRecord}>
                <Story />
            </StoryContextWrapper>
        ),
    ],
    parameters: {
        layout: 'fullscreen',
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        record: mockRecord,
        currentDateString: '2026-01-11',
        onResetDay: () => alert('Reset Day clicked'),
    },
};

export const ReadOnly: Story = {
    args: {
        ...Default.args,
        readOnly: true,
    },
};

export const Empty: Story = {
    args: {
        ...Default.args,
        record: {
            ...mockRecord,
            beds: Object.keys(mockRecord.beds).reduce((acc, bedId) => {
                acc[bedId] = { ...mockRecord.beds[bedId], patientName: '', rut: '', pathology: '' };
                return acc;
            }, {} as any),
        },
    },
};
