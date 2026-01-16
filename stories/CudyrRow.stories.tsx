import type { Meta, StoryObj } from '@storybook/react';
import { CudyrRow } from '../views/cudyr/CudyrRow';
import { createMockPatient, createMockCudyrScore } from './censusMocks';
import { BEDS } from '../constants';
import { StoryContextWrapper } from './StoryContextWrapper';

const meta: Meta<typeof CudyrRow> = {
    title: 'Cudyr/CudyrRow',
    component: CudyrRow,
    decorators: [
        (Story) => (
            <StoryContextWrapper>
                <table className="w-full border-collapse">
                    <tbody>
                        <Story />
                    </tbody>
                </table>
            </StoryContextWrapper>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockBed = BEDS[0];
const mockPatient = createMockPatient({
    bedId: mockBed.id,
    cudyr: createMockCudyrScore(),
});

export const Default: Story = {
    args: {
        bed: mockBed,
        patient: mockPatient,
        onScoreChange: (bedId, field, value) => console.log('Score changed', bedId, field, value),
    },
};

export const HighComplexity: Story = {
    args: {
        ...Default.args,
        patient: createMockPatient({
            bedId: mockBed.id,
            cudyr: createMockCudyrScore({
                vitalSigns: 3,
                fluidBalance: 3,
                oxygenTherapy: 3,
                pharmacology: 3,
            }),
        }),
    },
};

export const Empty: Story = {
    args: {
        ...Default.args,
        patient: { ...mockPatient, patientName: '', rut: '' },
    },
};

export const Crib: Story = {
    args: {
        ...Default.args,
        isCrib: true,
        patient: createMockPatient({
            bedId: mockBed.id,
            bedMode: 'Cuna',
            cudyr: createMockCudyrScore(),
        }),
    },
};
