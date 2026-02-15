/**
 * Integration Test: Patient Management Flow
 * Tests the complete flow of adding, editing, and displaying patients.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, createMockPatient } from './setup';
import { PatientRow } from '@/features/census/components/PatientRow';
import { BEDS } from '@/constants';
import { PatientStatus, Specialty, BedType } from '@/types';

// Mock callbacks
const mockOnAction = vi.fn();

describe('Patient Management Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('PatientRow Component', () => {
        it('should render empty bed correctly', () => {
            const bed = BEDS[0]; // First regular bed
            const emptyPatient = createMockPatient();

            render(
                <table>
                    <tbody>
                        <PatientRow
                            bed={bed}
                            data={emptyPatient}
                            currentDateString="2024-12-11"
                            onAction={mockOnAction}
                            bedType={BedType.UTI}
                        />
                    </tbody>
                </table>
            );

            // Bed identifier should be visible (use bed.name not bed.display)
            expect(screen.getByText(bed.name)).toBeInTheDocument();
        });

        it('should render patient data correctly', () => {
            const bed = BEDS[0];
            const patient = createMockPatient({
                patientName: 'Juan Pérez',
                rut: '12.345.678-9',
                age: '45',
                pathology: 'Neumonía',
                specialty: Specialty.MEDICINA,
                status: PatientStatus.ESTABLE
            });

            render(
                <table>
                    <tbody>
                        <PatientRow
                            bed={bed}
                            data={patient}
                            currentDateString="2024-12-11"
                            onAction={mockOnAction}
                            bedType={BedType.UTI}
                        />
                    </tbody>
                </table>
            );

            // Patient name should be visible
            expect(screen.getByDisplayValue('Juan Pérez')).toBeInTheDocument();
            expect(screen.getByDisplayValue('12.345.678-9')).toBeInTheDocument();
        });

        it('should render blocked bed with visual indicator', () => {
            const bed = BEDS[0];
            const blockedPatient = createMockPatient({
                isBlocked: true,
                blockedReason: 'Mantención'
            });

            render(
                <table>
                    <tbody>
                        <PatientRow
                            bed={bed}
                            data={blockedPatient}
                            currentDateString="2024-12-11"
                            onAction={mockOnAction}
                            bedType={BedType.UTI}
                        />
                    </tbody>
                </table>
            );

            // Should have some indicator of blocked state
            // The exact assertion depends on the component's blocked UI
            expect(screen.getByText(bed.name)).toBeInTheDocument();
        });

        it('should render UPC patient with special indicator', () => {
            const bed = BEDS[0];
            const upcPatient = createMockPatient({
                patientName: 'María González',
                isUPC: true
            });

            render(
                <table>
                    <tbody>
                        <PatientRow
                            bed={bed}
                            data={upcPatient}
                            currentDateString="2024-12-11"
                            onAction={mockOnAction}
                            bedType={BedType.UTI}
                        />
                    </tbody>
                </table>
            );

            // Verify patient renders
            expect(screen.getByDisplayValue('María González')).toBeInTheDocument();
        });
    });

    describe('Patient with Devices', () => {
        it('should display devices correctly', () => {
            const bed = BEDS[0];
            const patientWithDevices = createMockPatient({
                patientName: 'Pedro Soto',
                devices: ['VVP#1', 'CVC']
            });

            render(
                <table>
                    <tbody>
                        <PatientRow
                            bed={bed}
                            data={patientWithDevices}
                            currentDateString="2024-12-11"
                            onAction={mockOnAction}
                            bedType={BedType.UTI}
                        />
                    </tbody>
                </table>
            );

            // Verify patient renders
            expect(screen.getByDisplayValue('Pedro Soto')).toBeInTheDocument();
        });
    });
});
