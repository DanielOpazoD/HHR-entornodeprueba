/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HandoffRow, calculateHospitalizedDays } from '@/views/handoff/HandoffRow';
import { createMockPatient } from '../../integration/setup';
import { PatientStatus } from '@/types';

describe('HandoffRow Utilities', () => {
    it('calculateHospitalizedDays correctly counts days', () => {
        expect(calculateHospitalizedDays('2024-12-10', '2024-12-10')).toBe(1);
        expect(calculateHospitalizedDays('2024-12-10', '2024-12-11')).toBe(2);
        expect(calculateHospitalizedDays('2024-12-11', '2024-12-10')).toBe(1); // Should not go below 1
    });
});

describe('HandoffRow', () => {
    const defaultProps = {
        bedName: 'B1',
        bedType: 'CAMA',
        patient: createMockPatient({ patientName: 'Test Patient' }),
        reportDate: '2024-12-11',
        noteField: 'handoffNursingDay' as any,
        onNoteChange: vi.fn(),
    };

    it('renders null if patient name is missing', () => {
        const { queryByRole } = render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={createMockPatient({ patientName: '' })} />
                </tbody>
            </table>
        );
        expect(queryByRole('row')).toBeNull();
    });

    it('renders blocked bed status', () => {
        const blockedPatient = createMockPatient({
            isBlocked: true,
            blockedReason: 'Maintenance'
        });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={blockedPatient} />
                </tbody>
            </table>
        );
        expect(screen.getByText(/BLOQUEADA:/)).toBeInTheDocument();
        expect(screen.getByText(/Maintenance/)).toBeInTheDocument();
    });

    it('renders patient info correctly', () => {
        const patient = createMockPatient({
            patientName: 'Jane Doe',
            age: '45y',
            admissionDate: '2024-12-10',
            pathology: 'Flu'
        });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patient} />
                </tbody>
            </table>
        );
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('(45y)')).toBeInTheDocument();
        expect(screen.getByText('Flu')).toBeInTheDocument();
        expect(screen.getByText('2d')).toBeInTheDocument(); // Dec 10 to Dec 11 is 2 days
    });

    it('shows baby icon and RN tag for sub-rows', () => {
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} isSubRow={true} />
                </tbody>
            </table>
        );
        expect(screen.getByRole('row')).toHaveClass('bg-pink-50/40');
    });

    it('displays devices and their installation days', () => {
        const patient = createMockPatient({
            devices: ['VMI'],
            deviceDetails: {
                VMI: { installationDate: '2024-12-09' }
            }
        });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patient} />
                </tbody>
            </table>
        );
        expect(screen.getByText('VMI')).toBeInTheDocument();
        expect(screen.getByText('(3d)')).toBeInTheDocument(); // Dec 9 to Dec 11
    });

    it('handles note changes via DebouncedTextarea', () => {
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} />
                </tbody>
            </table>
        );
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'New Observation' } });
    });

    it('renders read-only observations correctly', () => {
        const patient = createMockPatient({ handoffNursingDay: 'Static Note' });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patient} readOnly={true} />
                </tbody>
            </table>
        );
        expect(screen.getByText('Static Note')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('renders differently in medical mode', () => {
        const patient = createMockPatient({ rut: '12.345.678-9' });
        render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={patient} isMedical={true} />
                </tbody>
            </table>
        );
        expect(screen.getByText('12.345.678-9')).toBeInTheDocument();
    });

    it('shows correct status colors', () => {
        const { rerender } = render(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={createMockPatient({ status: PatientStatus.GRAVE })} />
                </tbody>
            </table>
        );
        expect(screen.getByText(PatientStatus.GRAVE)).toHaveClass('bg-red-100');

        rerender(
            <table>
                <tbody>
                    <HandoffRow {...defaultProps} patient={createMockPatient({ status: PatientStatus.DE_CUIDADO })} />
                </tbody>
            </table>
        );
        expect(screen.getByText(PatientStatus.DE_CUIDADO)).toHaveClass('bg-orange-100');
    });
});
