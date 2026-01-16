import type { Meta, StoryObj } from '@storybook/react';
import { CensusStaffHeader } from '../views/census/CensusStaffHeader';
import { createMockDailyRecord, MOCK_STAFF } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof CensusStaffHeader> = {
    title: 'Census/CensusStaffHeader',
    component: CensusStaffHeader,
    decorators: [
        (Story) => (
            <StoryContextWrapper record={mockRecord}>
                <div className="bg-slate-50 p-4 rounded-xl">
                    <Story />
                </div>
            </StoryContextWrapper>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        allNurses: MOCK_STAFF.nurses,
        allTens: MOCK_STAFF.tens,
        record: mockRecord,
    },
};

export const Empty: Story = {
    args: {
        allNurses: [],
        allTens: [],
        record: {
            ...mockRecord,
            nursesDayShift: [],
            nursesNightShift: [],
            tensDayShift: [],
            tensNightShift: [],
        },
    },
};
