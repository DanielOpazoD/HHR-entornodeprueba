
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { useCensusActions } from '@/features/census/components/CensusActionsContext';
import { useDailyRecordActions, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@/features/census/components/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn(),
    useDailyRecordMovements: vi.fn()
}));

describe('DischargesSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();
    const mockUpdateDischarge = vi.fn();

    const mockDischarges = [
        DataFactory.createMockDischarge({
            id: '1',
            bedName: 'R1',
            patientName: 'John Doe',
            dischargeType: 'Domicilio (Habitual)'
        })
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusActions).mockReturnValue({ handleEditDischarge: mockHandleEdit } as any);
        (useDailyRecordActions as any).mockReturnValue({
            undoDischarge: mockOnUndo,
            deleteDischarge: mockOnDelete,
            updateDischarge: mockUpdateDischarge
        });
        // Default empty movements
        (useDailyRecordMovements as any).mockReturnValue({ discharges: [] });
    });

    it('renders empty message when no discharges', () => {
        (useDailyRecordMovements as any).mockReturnValue({
            discharges: []
        });

        render(<DischargesSection />);
        expect(screen.getByText(/No hay altas registradas/)).toBeInTheDocument();
    });

    it('renders discharge list and triggers actions', () => {
        (useDailyRecordMovements as any).mockReturnValue({
            discharges: mockDischarges
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
