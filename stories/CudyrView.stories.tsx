import type { Meta, StoryObj } from '@storybook/react';
import { CudyrView } from '../views/cudyr/CudyrView';
import { createMockDailyRecord } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof CudyrView> = {
    title: 'Cudyr/CudyrView',
    component: CudyrView,
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
        readOnly: false,
    },
};

export const ReadOnly: Story = {
    args: {
        readOnly: true,
    },
};
