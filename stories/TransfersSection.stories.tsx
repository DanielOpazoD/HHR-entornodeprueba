import type { Meta, StoryObj } from '@storybook/react';
import { TransfersSection } from '../views/census/TransfersSection';
import { createMockDailyRecord } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof TransfersSection> = {
    title: 'Census/Sections/TransfersSection',
    component: TransfersSection,
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
        transfers: mockRecord.transfers,
        onUndoTransfer: (id) => console.log('Undo transfer', id),
        onDeleteTransfer: (id) => console.log('Delete transfer', id),
    },
};

export const Empty: Story = {
    args: {
        transfers: [],
        onUndoTransfer: (id) => console.log('Undo transfer', id),
        onDeleteTransfer: (id) => console.log('Delete transfer', id),
    },
};
