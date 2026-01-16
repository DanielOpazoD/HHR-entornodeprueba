import type { Meta, StoryObj } from '@storybook/react';
import { CMASection } from '../views/census/CMASection';
import { createMockDailyRecord } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof CMASection> = {
    title: 'Census/Sections/CMASection',
    component: CMASection,
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
    args: {},
};

export const ReadOnly: Story = {
    args: {},
};
