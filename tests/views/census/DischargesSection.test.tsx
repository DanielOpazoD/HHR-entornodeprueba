
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DischargesSection } from '@/views/census/DischargesSection';
import { useCensusActions } from '@/views/census/CensusActionsContext';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';

vi.mock('@/views/census/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn()
}));

describe('DischargesSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();

    const mockDischarges = [
        {
            id: '1',
            bedName: 'R1',
            bedType: 'UTI',
            patientName: 'John Doe',
            rut: '1-1',
            diagnosis: 'Testing',
            dischargeType: 'Domicilio',
            status: 'Vivo' as const
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusActions).mockReturnValue({ handleEditDischarge: mockHandleEdit } as any);
        (useDailyRecordActions as any).mockReturnValue({
            undoDischarge: mockOnUndo,
            deleteDischarge: mockOnDelete
        });
    });

    it('renders empty message when no discharges', () => {
        (useDailyRecordData as any).mockReturnValue({
            record: { discharges: [] }
        });

        render(<DischargesSection />);
        expect(screen.getByText(/No hay altas registradas/)).toBeInTheDocument();
    });

    it('renders discharge list and triggers actions', () => {
        (useDailyRecordData as any).mockReturnValue({
            record: { discharges: mockDischarges }
        });

        render(<DischargesSection />);

        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('R1')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        expect(mockOnUndo).toHaveBeenCalledWith('1');

        fireEvent.click(screen.getByTitle('Editar'));
        expect(mockHandleEdit).toHaveBeenCalledWith(mockDischarges[0]);

        fireEvent.click(screen.getByTitle('Eliminar Registro'));
        expect(mockOnDelete).toHaveBeenCalledWith('1');
    });
});
