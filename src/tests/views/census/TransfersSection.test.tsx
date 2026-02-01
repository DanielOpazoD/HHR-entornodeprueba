
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import { useCensusActions } from '@/features/census/components/CensusActionsContext';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@/features/census/components/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn()
}));

describe('TransfersSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();

    const mockTransfers = [
        DataFactory.createMockTransfer({
            id: 't1',
            bedName: 'R2',
            patientName: 'Jane Smith',
            receivingCenter: 'Hospital A',
            transferEscort: 'Nurse X'
        })
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCensusActions).mockReturnValue({ handleEditTransfer: mockHandleEdit } as any);
        (useDailyRecordActions as any).mockReturnValue({
            undoTransfer: mockOnUndo,
            deleteTransfer: mockOnDelete,
            updateTransfer: vi.fn()
        });
    });

    it('renders empty message when no transfers', () => {
        (useDailyRecordData as any).mockReturnValue({
            record: { transfers: [] }
        });

        render(<TransfersSection />);
        expect(screen.getByText(/No hay traslados registrados/)).toBeInTheDocument();
    });

    it('renders transfer list and triggers actions', () => {
        (useDailyRecordData as any).mockReturnValue({
            record: { transfers: mockTransfers }
        });

        render(<TransfersSection />);

        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('R2')).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('Nurse X'))).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        expect(mockOnUndo).toHaveBeenCalledWith('t1');

        fireEvent.click(screen.getByTitle('Editar'));
        expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

        fireEvent.click(screen.getByTitle('Eliminar Registro'));
        expect(mockOnDelete).toHaveBeenCalledWith('t1');
    });
});
