import type { Meta, StoryObj } from '@storybook/react';
import { CensusStaffHeader } from '@/features/census/components/CensusStaffHeader';
import { createMockDailyRecord, createMockStats } from './censusMocks';
import { StoryContextWrapper } from './StoryContextWrapper';

const mockRecord = createMockDailyRecord();

const meta: Meta<typeof CensusStaffHeader> = {
  title: 'Census/CensusStaffHeader',
  component: CensusStaffHeader,
  decorators: [
    Story => (
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
    selectedDate: mockRecord.date,
    stats: createMockStats(),
  },
};

export const Empty: Story = {
  decorators: [
    Story => (
      <StoryContextWrapper
        record={{
          ...mockRecord,
          nursesDayShift: [],
          nursesNightShift: [],
          tensDayShift: [],
          tensNightShift: [],
        }}
      >
        <Story />
      </StoryContextWrapper>
    ),
  ],
  args: {
    selectedDate: mockRecord.date,
    stats: null,
  },
};
