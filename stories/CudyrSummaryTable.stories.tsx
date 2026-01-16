import type { Meta, StoryObj } from '@storybook/react';
import { CudyrSummaryTable } from '../views/cudyr/CudyrSummaryTable';

const meta: Meta<typeof CudyrSummaryTable> = {
    title: 'Cudyr/CudyrSummaryTable',
    component: CudyrSummaryTable,
    parameters: {
        layout: 'padded',
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockCounts = {
    uti: {
        A1: 2, A2: 1, A3: 0,
        B1: 1, B2: 0, B3: 0,
        C1: 0, C2: 0, C3: 0,
        D1: 0, D2: 0, D3: 0,
    },
    media: {
        A1: 0, A2: 0, A3: 0,
        B1: 1, B2: 2, B3: 1,
        C1: 3, C2: 1, C3: 0,
        D1: 1, D2: 0, D3: 0,
    }
};

export const Default: Story = {
    args: {
        counts: mockCounts as any,
        utiTotal: 4,
        mediaTotal: 10,
    },
};

export const Empty: Story = {
    args: {
        counts: {
            uti: { A1: 0, A2: 0, A3: 0, B1: 0, B2: 0, B3: 0, C1: 0, C2: 0, C3: 0, D1: 0, D2: 0, D3: 0 },
            media: { A1: 0, A2: 0, A3: 0, B1: 0, B2: 0, B3: 0, C1: 0, C2: 0, C3: 0, D1: 0, D2: 0, D3: 0 }
        } as any,
        utiTotal: 0,
        mediaTotal: 0,
    },
};
