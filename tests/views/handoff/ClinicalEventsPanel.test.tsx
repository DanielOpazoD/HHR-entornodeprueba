/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClinicalEventsPanel } from '@/views/handoff/ClinicalEventsPanel';
import { ClinicalEvent } from '@/types';

describe('ClinicalEventsPanel', () => {
    const mockEvents: ClinicalEvent[] = [
        {
            id: 'evt-1',
            name: 'Cirugía de Cadera',
            date: '2025-01-01',
            note: 'Sin complicaciones',
            createdAt: '2025-01-01T10:00:00Z'
        }
    ];

    const defaultProps = {
        events: mockEvents,
        onAdd: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
    };

    it('renders the list of events', () => {
        render(<ClinicalEventsPanel {...defaultProps} />);
        expect(screen.getByText('Cirugía de Cadera')).toBeInTheDocument();
        expect(screen.getByText('(01-01-2025)')).toBeInTheDocument();
        expect(screen.getByText('Sin complicaciones')).toBeInTheDocument();
    });

    it('shows the add form when clicking the add button', () => {
        render(<ClinicalEventsPanel {...defaultProps} events={[]} />);
        const addButton = screen.getByTitle(/Agregar evento/i);
        fireEvent.click(addButton);

        expect(screen.getByPlaceholderText(/Nombre del evento/i)).toBeInTheDocument();
        expect(screen.getByText(/Guardar/i)).toBeInTheDocument();
    });

    it('calls onAdd with correct data', () => {
        render(<ClinicalEventsPanel {...defaultProps} events={[]} />);
        fireEvent.click(screen.getByTitle(/Agregar evento/i));

        fireEvent.change(screen.getByPlaceholderText(/Nombre del evento/i), { target: { value: 'Nuevo Evento' } });
        fireEvent.change(screen.getByPlaceholderText(/Nota \(opcional\)/i), { target: { value: 'Nueva Nota' } });

        fireEvent.click(screen.getByText(/Guardar/i));

        expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Nuevo Evento'
        }));
    });

    it('shows the edit form and calls onUpdate', () => {
        render(<ClinicalEventsPanel {...defaultProps} />);

        const editButton = screen.getByTitle(/Editar evento/i);
        fireEvent.click(editButton);

        const input = screen.getByDisplayValue('Cirugía de Cadera');
        fireEvent.change(input, { target: { value: 'Cirugía Modificada' } });

        fireEvent.click(screen.getByText(/Guardar/i));

        expect(defaultProps.onUpdate).toHaveBeenCalledWith('evt-1', expect.objectContaining({
            name: 'Cirugía Modificada'
        }));
    });

    it('shows delete confirmation and calls onDelete', () => {
        render(<ClinicalEventsPanel {...defaultProps} />);
        fireEvent.click(screen.getByTitle(/Editar evento/i));

        const deleteButton = screen.getByTitle(/Eliminar evento/i);
        fireEvent.click(deleteButton);

        // Al hacer clic en el basurero del formulario, se activa el modo de confirmación
        expect(screen.getByText(/¿Eliminar este evento\?/i)).toBeInTheDocument();

        const confirmButton = screen.getByTitle(/Confirmar/i);
        fireEvent.click(confirmButton);

        expect(defaultProps.onDelete).toHaveBeenCalledWith('evt-1');
    });

    it('renders in readOnly mode without action buttons', () => {
        render(<ClinicalEventsPanel {...defaultProps} readOnly={true} />);

        expect(screen.queryByTitle(/Agregar evento/i)).not.toBeInTheDocument();
        expect(screen.queryByTitle(/Editar evento/i)).not.toBeInTheDocument();
    });
});
