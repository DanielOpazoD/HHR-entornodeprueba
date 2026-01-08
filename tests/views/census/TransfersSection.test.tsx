import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TransfersSection } from '@/views/census/TransfersSection';
import { useCensusActions } from '@/views/census/CensusActionsContext';

vi.mock('@/views/census/CensusActionsContext', () => ({
    useCensusActions: vi.fn()
}));

describe('TransfersSection', () => {
    const mockOnUndo = vi.fn();
    const mockOnDelete = vi.fn();
    const mockHandleEdit = vi.fn();

    const mockTransfers = [
        {
            id: 't1',
            bedName: 'R2',
            bedType: 'MEDIA',
            patientName: 'Jane Smith',
            rut: '2-2',
            diagnosis: 'Transfer Test',
            evacuationMethod: 'Avión comercial',
            receivingCenter: 'Hospital A',
            transferEscort: 'Nurse X'
        }
    ];

    beforeEach(() => {
        vi.mocked(useCensusActions).mockReturnValue({ handleEditTransfer: mockHandleEdit } as any);
    });

    it('renders empty message when no transfers', () => {
        render(<TransfersSection transfers={[]} onUndoTransfer={mockOnUndo} onDeleteTransfer={mockOnDelete} />);
        expect(screen.getByText(/No hay traslados registrados/)).toBeInTheDocument();
    });

    it('renders transfer list and triggers actions', () => {
        render(<TransfersSection transfers={mockTransfers as any} onUndoTransfer={mockOnUndo} onDeleteTransfer={mockOnDelete} />);

        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('R2')).toBeInTheDocument();
        expect(screen.getByText('Nurse X')).toBeInTheDocument(); // Condition on 'Avión comercial'

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        expect(mockOnUndo).toHaveBeenCalledWith('t1');

        fireEvent.click(screen.getByTitle('Editar'));
        expect(mockHandleEdit).toHaveBeenCalledWith(mockTransfers[0]);

        fireEvent.click(screen.getByTitle('Eliminar Registro'));
        expect(mockOnDelete).toHaveBeenCalledWith('t1');
    });
});
