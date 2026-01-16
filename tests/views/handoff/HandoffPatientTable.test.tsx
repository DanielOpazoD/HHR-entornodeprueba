/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HandoffPatientTable } from '@/views/handoff/HandoffPatientTable';
import { createMockPatient } from '../../integration/setup';
import { BEDS } from '@/constants';

describe('HandoffPatientTable', () => {
    const mockRecord = {
        date: '2025-01-01',
        beds: {
            R1: createMockPatient({
                patientName: 'Patient 1',
                clinicalEvents: [{ id: 'e1', name: 'Cirugía P1', date: '2025-01-01', note: '', createdAt: '' }]
            }),
            R2: createMockPatient({ patientName: 'Patient 2' })
        }
    };

    const defaultProps = {
        visibleBeds: BEDS.filter(b => b.id === 'R1' || b.id === 'R2'),
        record: mockRecord as any,
        noteField: 'handoffNoteDayShift' as any,
        onNoteChange: vi.fn(),
        tableHeaderClass: 'bg-slate-50',
        readOnly: false,
        isMedical: false,
        hasAnyPatients: true,
        shouldShowPatient: () => true,
        onClinicalEventAdd: vi.fn(),
        onClinicalEventUpdate: vi.fn(),
        onClinicalEventDelete: vi.fn(),
    };

    it('toggles global expansion state when header button is clicked', () => {
        render(<HandoffPatientTable {...defaultProps} />);

        // Inicialmente el evento no debería estar visible
        expect(screen.queryByText('Cirugía P1')).not.toBeInTheDocument();

        // Botón de expansión global
        const globalExpandBtn = screen.getByTitle(/Expandir todos los eventos/i);
        fireEvent.click(globalExpandBtn);

        // Ahora debería aparecer el evento
        expect(screen.getByText('Cirugía P1')).toBeInTheDocument();

        // Botón de colapso global
        const globalCollapseBtn = screen.getByTitle(/Colapsar todos los eventos/i);
        fireEvent.click(globalCollapseBtn);

        expect(screen.queryByText('Cirugía P1')).not.toBeInTheDocument();
    });

    it('does not show global expand button in medical mode', () => {
        render(<HandoffPatientTable {...defaultProps} isMedical={true} />);
        expect(screen.queryByTitle(/Expandir todos los eventos/i)).not.toBeInTheDocument();
    });
});
