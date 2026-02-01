import type { Meta, StoryObj } from '@storybook/react';
import { HandoffRow } from '@/views/handoff/HandoffRow';
import { PatientStatus, Specialty, PatientData } from '@/types';

const meta: Meta<typeof HandoffRow> = {
    title: 'Hospital/HandoffRow',
    component: HandoffRow,
    decorators: [
        (Story) => (
            <table className="w-full border-collapse">
                <tbody>
                    <Story />
                </tbody>
            </table>
        ),
    ],
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const mockPatient: PatientData = {
    bedId: 'BED_01',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'JUAN PEREZ GONZALEZ',
    rut: '12.345.678-9',
    age: '45a',
    admissionDate: '2024-12-20',
    pathology: 'INSUFICIENCIA RESPIRATORIA AGUDA',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.GRAVE,
    hasWristband: true,
    devices: ['VMI', 'CVC'],
    deviceDetails: {
        VMI: { installationDate: '2024-12-21' },
        CVC: { installationDate: '2024-12-22' }
    },
    surgicalComplication: false,
    isUPC: true,
    handoffNoteDayShift: 'Paciente estable dentro de su gravedad. Vigilancia hemodinámica estricta.',
    medicalHandoffNote: 'Evolución lenta. Mantener ventilación mecánica.',
};

export const Normal: Story = {
    args: {
        bedName: 'R1',
        bedType: 'UCI',
        patient: { ...mockPatient },
        reportDate: '2024-12-25',
        noteField: 'handoffNoteDayShift',
        onNoteChange: (val) => console.log('Saved:', val),
    },
};

export const Blocked: Story = {
    args: {
        bedName: 'R2',
        bedType: 'UCI',
        patient: {
            ...mockPatient,
            isBlocked: true,
            blockedReason: 'Mantenimiento preventivo de monitor'
        },
        reportDate: '2024-12-25',
        noteField: 'handoffNoteDayShift',
        onNoteChange: () => { },
    },
};

export const SubRowExtraBed: Story = {
    args: {
        bedName: 'R1',
        bedType: 'UCI',
        patient: { ...mockPatient, patientName: 'BEBE DE PRUEBA' },
        reportDate: '2024-12-25',
        isSubRow: true,
        noteField: 'handoffNoteDayShift',
        onNoteChange: () => { },
    },
};

export const ReadOnlyMedical: Story = {
    args: {
        bedName: 'R4',
        bedType: 'UTI',
        patient: { ...mockPatient, status: PatientStatus.ESTABLE },
        reportDate: '2024-12-25',
        noteField: 'medicalHandoffNote',
        readOnly: true,
        onNoteChange: () => { },
    },
};
