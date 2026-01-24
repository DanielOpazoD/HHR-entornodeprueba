/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { HandoffView } from '@/views/handoff/HandoffView';
import { render, createMockRecord, createMockPatient, createMockDailyRecordContext, createMockUIState } from '../../integration/setup';

// Mock the hook directly because auth-triggered StaffContext is hard to stabilize in unit tests
vi.mock('@/context/StaffContext', () => ({
    useStaffContext: () => ({
        nursesList: ['Nurse 1', 'Nurse 2', 'Test Nurse'],
        tensList: ['TENS 1', 'TENS 2'],
        showNurseManager: false,
        setShowNurseManager: vi.fn(),
        showTensManager: false,
        setShowTensManager: vi.fn(),
    }),
    StaffProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

describe('HandoffView Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders empty message when no record is selected', () => {
        render(<HandoffView />, { contextValue: createMockDailyRecordContext(null as any) });
        expect(screen.getByText(/Seleccione una fecha para ver la Entrega de Turno/i)).toBeInTheDocument();
    });

    it('renders nursing handoff with correct title', () => {
        const record = createMockRecord('2024-12-11');
        render(<HandoffView type="nursing" />, { contextValue: createMockDailyRecordContext(record) });

        expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();
    });

    it('allows switching between day and night shifts', () => {
        const record = createMockRecord('2024-12-11');
        const ui = createMockUIState({ selectedShift: 'day' });

        const { rerender } = render(<HandoffView type="nursing" ui={ui} />, {
            contextValue: createMockDailyRecordContext(record)
        });

        expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();

        const nightUi = { ...ui, selectedShift: 'night' as const };
        rerender(<HandoffView type="nursing" ui={nightUi} />);

        expect(screen.getByText(/Entrega Turno Enfermería - Noche/i)).toBeInTheDocument();
    });

    it('displays patients based on shift boundaries', async () => {
        const record = createMockRecord('2024-12-11');

        // Ensure beds exist
        record.beds = {};

        // Admitted Jan 11 at 10:00 (During day shift)
        record.beds['R1'] = createMockPatient({
            bedId: 'R1',
            patientName: 'PACIENTE DIA',
            admissionDate: '2024-12-11',
            admissionTime: '10:00'
        });

        // Admitted Jan 12 at 10:00 (Next day morning - outside night shift)
        record.beds['R2'] = createMockPatient({
            bedId: 'R2',
            patientName: 'PACIENTE MANANA',
            admissionDate: '2024-12-12',
            admissionTime: '10:00'
        });

        // Jan 12 at 02:00 (During night shift of the 11th)
        record.beds['R3'] = createMockPatient({
            bedId: 'R3',
            patientName: 'PACIENTE MADRUGADA',
            admissionDate: '2024-12-12',
            admissionTime: '02:00'
        });

        const dayUi = createMockUIState({ selectedShift: 'day' });
        const { rerender } = render(<HandoffView type="nursing" ui={dayUi} />, {
            contextValue: createMockDailyRecordContext(record)
        });

        // We check within the interactive patient table to avoid matches in headers or print sections
        const mainTable = screen.getByRole('table');

        expect(within(mainTable).getByText('PACIENTE DIA')).toBeInTheDocument();
        expect(within(mainTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
        expect(within(mainTable).queryByText('PACIENTE MADRUGADA')).not.toBeInTheDocument();

        // Switch to night shift
        const nightUi = { ...dayUi, selectedShift: 'night' as const };
        rerender(<HandoffView type="nursing" ui={nightUi} />);

        // Re-find table because it might have been re-rendered
        const nightTable = screen.getAllByRole('table')[0]; // First table is the interactive one

        expect(within(nightTable).getByText('PACIENTE DIA')).toBeInTheDocument();
        expect(within(nightTable).getByText('PACIENTE MADRUGADA')).toBeInTheDocument();
        expect(within(nightTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
    });

    it('updates handoff staff when selection changes (Night Shift only)', async () => {
        const record = createMockRecord('2024-12-11');
        const mockContext = createMockDailyRecordContext(record);
        // We MUST be in Night Shift for 'Recibe' to be editable
        const ui = createMockUIState({ selectedShift: 'night' });

        render(<HandoffView type="nursing" ui={ui} />, { contextValue: mockContext });

        // Target the interactive staff selector (Recibe)
        const staffSections = screen.getAllByText('Recibe');
        // Find the one that has selects in its container (the interactive one)
        const receivesSection = staffSections.find(s => s.closest('div')?.parentElement?.querySelectorAll('select').length === 2);
        const container = receivesSection!.closest('div')?.parentElement;
        const selects = within(container!).getAllByRole('combobox');

        fireEvent.change(selects[0], { target: { value: 'Test Nurse' } });

        await waitFor(() => {
            expect(mockContext.updateHandoffStaff).toHaveBeenCalledWith(
                'night',
                'receives',
                ['Test Nurse', '']
            );
        });
    });

    it('displays and updates handoff novedades', async () => {
        const record = createMockRecord('2024-12-11');
        record.handoffNovedadesDayShift = 'Initial novedades';
        const mockContext = createMockDailyRecordContext(record);

        render(<HandoffView type="nursing" />, { contextValue: mockContext });

        const textarea = screen.getByPlaceholderText(/Escriba las novedades del turno aquí/i);
        expect(textarea).toHaveValue('Initial novedades');

        fireEvent.change(textarea, { target: { value: 'Updated novedades' } });
        fireEvent.blur(textarea);

        await waitFor(() => {
            expect(mockContext.updateHandoffNovedades).toHaveBeenCalledWith('day', 'Updated novedades');
        });
    });

    it('handles medical handoff view', () => {
        const record = createMockRecord('2024-12-11');
        render(<HandoffView type="medical" />, { contextValue: createMockDailyRecordContext(record) });

        expect(screen.getByText(/Entrega Turno Médicos/i)).toBeInTheDocument();
    });
});
