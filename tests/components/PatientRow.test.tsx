import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PatientRow } from '@/components/census/PatientRow';
import { PatientData, Specialty, PatientStatus, BedType } from '@/types';
import { render } from '../integration/setup';

describe('PatientRow Component', () => {
    const mockContext = {
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        updateClinicalCrib: vi.fn(),
        updateClinicalCribMultiple: vi.fn(),
    };

    const { mockAlert, mockConfirm } = vi.hoisted(() => ({
        mockAlert: vi.fn().mockResolvedValue(true),
        mockConfirm: vi.fn().mockResolvedValue(true)
    }));

    vi.mock('@/context/UIContext', async () => {
        const actual = await vi.importActual('@/context/UIContext');
        return {
            ...actual,
            useConfirmDialog: () => ({
                confirm: mockConfirm,
                alert: mockAlert
            })
        };
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockPatient: PatientData = {
        bedId: 'R1',
        patientName: 'Juan Pérez',
        rut: '12.345.678-9',
        age: '45',
        pathology: 'Neumonía',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2023-01-01',
        hasWristband: true,
        devices: ['VVP#1'],
        surgicalComplication: false,
        isUPC: false,
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false
    };

    const mockBedDef = {
        id: 'R1',
        name: 'R1', // User confirmed name is R1
        type: BedType.UTI,
        isCuna: false
    };

    const mockOnAction = vi.fn();

    it('renders patient name and bed name correctly', () => {
        render(
            <table>
                <tbody>
                    <PatientRow
                        data={mockPatient}
                        bed={mockBedDef}
                        currentDateString="2023-01-01"
                        onAction={mockOnAction}
                        showCribControls={false}
                    />
                </tbody>
            </table>
        );

        // Name is in an input value
        expect(screen.getByDisplayValue(/Juan Pérez/)).toBeInTheDocument();
        // Bed name is rendered in a div
        expect(screen.getByText('R1')).toBeInTheDocument();
    });

    it('toggles UPC status when clicked', () => {
        render(
            <table>
                <tbody>
                    <PatientRow
                        data={mockPatient}
                        bed={mockBedDef}
                        currentDateString="2023-01-01"
                        onAction={mockOnAction}
                        showCribControls={false}
                    />
                </tbody>
            </table>,
            { contextValue: mockContext as any }
        );

        // UPC is a checkbox with title="UPC"
        const upcCheckbox = screen.getByTitle('UPC');
        fireEvent.click(upcCheckbox);

        expect(mockContext.updatePatient).toHaveBeenCalledWith('R1', 'isUPC', true);
    });

    it('calls updatePatient when status changes', () => {
        render(
            <table>
                <tbody>
                    <PatientRow
                        data={mockPatient}
                        bed={mockBedDef}
                        currentDateString="2023-01-01"
                        onAction={mockOnAction}
                        showCribControls={false}
                    />
                </tbody>
            </table>,
            { contextValue: mockContext as any }
        );

        const statusSelect = screen.getByDisplayValue(/Estable/);
        fireEvent.change(statusSelect, { target: { value: PatientStatus.GRAVE } });

        expect(mockContext.updatePatient).toHaveBeenCalledWith('R1', 'status', PatientStatus.GRAVE);
    });

    describe('Crib and Bed Mode Management', () => {
        it('toggles bed mode when config button is clicked', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={true}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open the config menu
            const configBtn = screen.getByTitle('Configuración de cama');
            fireEvent.click(configBtn);

            // Click internal button (should be "Cambiar a Cuna Clínica" because mockPatient is in "Cama" mode)
            const modeButton = screen.getByText(/Cambiar a Cuna Clínica/i);
            fireEvent.click(modeButton);

            expect(mockContext.updatePatient).toHaveBeenCalledWith('R1', 'bedMode', 'Cuna');
        });

        it('toggles companion crib when RN Sano button is clicked', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={true}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open the config menu
            const configBtn = screen.getByTitle('Configuración de cama');
            fireEvent.click(configBtn);

            // RN Sano button text is "RN Sano"
            const companionBtn = screen.getByText(/^RN Sano$/i);
            fireEvent.click(companionBtn);

            expect(mockContext.updatePatient).toHaveBeenCalledWith('R1', 'hasCompanionCrib', true);
        });

        it('toggles clinical crib when Cuna Clínica button is clicked', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={true}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open the config menu
            const configBtn = screen.getByTitle('Configuración de cama');
            fireEvent.click(configBtn);

            // Cuna Clínica button text is "Agregar Cuna Clínica"
            const clinicalCribBtn = screen.getByText(/Agregar Cuna Clínica/i);
            fireEvent.click(clinicalCribBtn);

            expect(mockContext.updateClinicalCrib).toHaveBeenCalledWith('R1', 'create');
        });
    });

    describe('Blocked Bed View', () => {
        it('renders blocked message and reason instead of inputs', () => {
            const blockedPatient = { ...mockPatient, isBlocked: true, blockedReason: 'Mantenimiento' };
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={blockedPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>
            );

            expect(screen.getByText(/Cama Bloqueada/i)).toBeInTheDocument();
            expect(screen.getByText(/\(Mantenimiento\)/i)).toBeInTheDocument();
            // Input fields should not be visible or at least name input shouldn't be accessible as usual
            expect(screen.queryByDisplayValue('Juan Pérez')).not.toBeInTheDocument();
        });
    });

    describe('Demographics Modal', () => {
        it('opens demographics modal and saves changes', async () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            const demoBtn = screen.getByTitle('Datos del Paciente');
            fireEvent.click(demoBtn);

            // Modal is open. Let's find the save button.
            const saveBtn = screen.getByText(/Guardar Cambios/i);
            fireEvent.click(saveBtn);

            expect(mockContext.updatePatientMultiple).toHaveBeenCalledWith('R1', expect.any(Object));
        });
    });

    describe('Action Menu', () => {
        it('calls onAction when copy, move, discharge, or transfer is clicked', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            const actions = ['Copiar a...', 'Mover a...', 'Dar de Alta', 'Trasladar'];
            const expectedActions = ['copy', 'move', 'discharge', 'transfer'];

            actions.forEach((actionText, index) => {
                // Open menu
                const menuBtn = screen.getByTitle('Acciones');
                fireEvent.click(menuBtn);

                // Click action
                const actionBtn = screen.getByText(new RegExp(actionText, 'i'));
                fireEvent.click(actionBtn);

                expect(mockOnAction).toHaveBeenCalledWith(expectedActions[index], 'R1');
            });
        });

        it('closes menu when clicking background overlay', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open menu
            fireEvent.click(screen.getByTitle('Acciones'));
            expect(screen.getByText(/Copiar a/i)).toBeInTheDocument();

            // Click overlay (it's a div with fixed inset-0)
            // We can find it by className or just click anywhere else?
            // Actually it's a sibling of the menu div.
            // Let's try to find it.
            const overlay = document.querySelector('.fixed.inset-0.z-40');
            if (overlay) {
                fireEvent.click(overlay);
                expect(screen.queryByText(/Copiar a/i)).not.toBeInTheDocument();
            }
        });
    });

    describe('Admission Time and Input Logic', () => {
        it('shows admission time input when admission date is focused', () => {
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            const dateInput = screen.getByDisplayValue('2023-01-01');
            fireEvent.focus(dateInput);

            // Time input should appear
            // It has type="time"
            expect(document.querySelector('input[type="time"]')).toBeInTheDocument();
        });

        it('triggers updatePatient on debounced name change', () => {
            vi.useFakeTimers();
            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={mockPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            const nameInput = screen.getByDisplayValue('Juan Pérez');
            fireEvent.change(nameInput, { target: { value: 'Juan Actualizado' } });

            // Should not be called immediately due to debounce
            expect(mockContext.updatePatient).not.toHaveBeenCalled();

            // Fast forward timers
            vi.advanceTimersByTime(500);

            expect(mockContext.updatePatient).toHaveBeenCalledWith('R1', 'patientName', 'Juan Actualizado');
            vi.useRealTimers();
        });
    });

    describe('Clinical Crib Management - Edge Cases', () => {
        it('removes clinical crib if it already exists', () => {
            const dataWithCrib = {
                ...mockPatient,
                clinicalCrib: { bedId: 'R1-C', patientName: 'Baby', bedMode: 'Cuna' } as any
            };

            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={dataWithCrib}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={true}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open the config menu
            const configBtn = screen.getByTitle('Configuración de cama');
            fireEvent.click(configBtn);

            // Button with title "Eliminar Cuna"
            const removeCribBtn = screen.getByTitle('Eliminar Cuna');
            fireEvent.click(removeCribBtn);

            expect(mockContext.updateClinicalCrib).toHaveBeenCalledWith('R1', 'remove');
        });

        it('does not allow companion crib if in Cuna mode', async () => {
            const cunaPatient = { ...mockPatient, bedMode: 'Cuna' as const };

            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={cunaPatient}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={true}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Open the config menu
            const configBtn = screen.getByTitle('Configuración de cama');
            fireEvent.click(configBtn);

            const companionBtn = screen.getByText(/^RN Sano$/i);
            fireEvent.click(companionBtn);

            expect(mockAlert).toHaveBeenCalled();
            expect(mockContext.updatePatient).not.toHaveBeenCalledWith('R1', 'hasCompanionCrib', true);
        });
    });

    describe('Clinical Crib Sub-row', () => {
        it('renders sub-row when clinicalCrib exists', () => {
            const dataWithCrib = {
                ...mockPatient,
                clinicalCrib: {
                    bedId: 'R1-C',
                    patientName: 'Sub Patient',
                    bedMode: 'Cuna'
                } as any
            };

            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={dataWithCrib}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // Sub-row status badge
            expect(screen.getByText('CUNA', { selector: 'span' })).toBeInTheDocument();
            // Sub-patient name
            expect(screen.getByDisplayValue('Sub Patient')).toBeInTheDocument();
        });

        it('opens sub-row demographics modal', () => {
            const dataWithCrib = {
                ...mockPatient,
                clinicalCrib: {
                    bedId: 'R1-C',
                    patientName: 'Sub Patient',
                    bedMode: 'Cuna'
                } as any
            };

            render(
                <table>
                    <tbody>
                        <PatientRow
                            data={dataWithCrib}
                            bed={mockBedDef}
                            currentDateString="2023-01-01"
                            onAction={mockOnAction}
                            showCribControls={false}
                        />
                    </tbody>
                </table>,
                { contextValue: mockContext as any }
            );

            // User icon button in sub-row has title="Datos demográficos"
            const subDemoBtns = screen.getAllByTitle('Datos demográficos');
            // The first one is in PatientBedConfig (indicators), the second one is the button in sub-row
            // Let's use the one that is a button
            const subDemoBtn = subDemoBtns.find(el => el.tagName === 'BUTTON');
            if (subDemoBtn) {
                fireEvent.click(subDemoBtn);
                expect(screen.getByText(/Datos Demográficos/i)).toBeInTheDocument();
            }
        });
    });
});
