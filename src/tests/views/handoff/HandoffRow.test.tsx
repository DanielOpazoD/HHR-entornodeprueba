/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { HandoffRow } from '@/features/handoff/components/HandoffRow';
import { render, createMockPatient } from '../../integration/setup';
import { PatientStatus } from '@/types';

describe('HandoffRow', () => {
    const mockPatient = createMockPatient({
        patientName: 'Test Patient',
        pathology: 'Pathology Test',
        admissionDate: '2024-12-01',
        status: PatientStatus.GRAVE
    });

    const defaultProps = {
        bedName: 'B1',
        bedType: 'Cama' as const,
        patient: mockPatient,
        reportDate: '2024-12-28',
        noteField: 'handoffNoteDayShift' as const,
        onNoteChange: vi.fn(),
        readOnly: false,
        isMedical: false
    };

    it('renders basic patient information', () => {
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} />
                </tbody>
            </table>
        );
        expect(screen.getByText('Test Patient')).toBeInTheDocument();
        expect(screen.getByText('B1')).toBeInTheDocument();
        expect(screen.getByText('Pathology Test')).toBeInTheDocument();
    });

    it('calculates and displays hospitalized days correctly', () => {
        const patientWithAdmission = createMockPatient({ admissionDate: '2024-12-01' });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patientWithAdmission} reportDate="2024-12-11" />
                </tbody>
            </table>
        );
        // From 1 to 11 is 11 days (counting both ends)
        expect(screen.getAllByText(/11d/i)).toHaveLength(2); // One mobile, one desktop
    });

    it('displays status badge with correct color', () => {
        const { rerender } = render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} />
                </tbody>
            </table>
        );
        expect(screen.getByText(PatientStatus.GRAVE)).toHaveClass('bg-red-50');

        const cuidadoPatient = createMockPatient({ status: PatientStatus.DE_CUIDADO });
        rerender(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={cuidadoPatient} />
                </tbody>
            </table>
        );
        expect(screen.getByText(PatientStatus.DE_CUIDADO)).toHaveClass('bg-orange-50');
    });

    it('displays event indicator when clinicalEvents exist', () => {
        const patientWithEvents = createMockPatient({
            clinicalEvents: [{ id: '1', name: 'Test Event', date: '2024-12-11', note: '', createdAt: '' }]
        });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patientWithEvents} />
                </tbody>
            </table>
        );
        const expandButton = screen.getByTitle(/Ver eventos clínicos/i);
        expect(expandButton).toHaveClass('shadow-sm'); // Indicativo de que tiene eventos (bg-medical-50)
    });

    it('expands clinical events panel when forcedExpand is true', () => {
        const patientWithEvents = createMockPatient({
            clinicalEvents: [{ id: '1', name: 'Test Event', date: '2024-12-11', note: '', createdAt: '' }]
        });
        const { rerender } = render(
            <table>
                <tbody>
                    <HandoffRow
                        {...defaultProps}
                        patient={patientWithEvents}
                        forcedExpand={false}
                        onClinicalEventAdd={vi.fn()}
                        onClinicalEventUpdate={vi.fn()}
                        onClinicalEventDelete={vi.fn()}
                    />
                </tbody>
            </table>
        );
        expect(screen.queryByText('Test Event')).not.toBeInTheDocument();

        rerender(
            <table>
                <tbody>
                    <HandoffRow
                        {...defaultProps}
                        patient={patientWithEvents}
                        forcedExpand={true}
                        onClinicalEventAdd={vi.fn()}
                        onClinicalEventUpdate={vi.fn()}
                        onClinicalEventDelete={vi.fn()}
                    />
                </tbody>
            </table>
        );
        expect(screen.getByText('Test Event')).toBeInTheDocument();
    });
});
