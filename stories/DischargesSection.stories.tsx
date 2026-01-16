import type { Meta, StoryObj } from '@storybook/react';
import { DischargesSection } from '../views/census/DischargesSection';
import { createMockDailyRecord } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof DischargesSection> = {
    title: 'Census/Sections/DischargesSection',
    component: DischargesSection,
    decorators: [
        (Story) => (
            <StoryContextWrapper record={mockRecord}>
                <div className="max-w-4xl mx-auto">
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
        discharges: mockRecord.discharges,
        onUndoDischarge: (id) => console.log('Undo discharge', id),
        onDeleteDischarge: (id) => console.log('Delete discharge', id),
    },
};

export const Empty: Story = {
    args: {
        discharges: [],
        onUndoDischarge: (id) => console.log('Undo discharge', id),
        onDeleteDischarge: (id) => console.log('Delete discharge', id),
    },
};
