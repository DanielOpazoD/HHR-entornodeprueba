/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { CudyrView } from '@/views/cudyr/CudyrView';
import { render, createMockRecord, createMockPatient, createMockDailyRecordContext } from '../../integration/setup';

describe('CudyrView Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders empty message when no record is selected', () => {
        render(<CudyrView />, { contextValue: createMockDailyRecordContext(null as any) });
        expect(screen.getByText(/Seleccione una fecha con registros/i)).toBeInTheDocument();
    });

    it('renders patient rows correctly', () => {
        const record = createMockRecord('2024-12-11');
        record.beds['R1'] = createMockPatient({
            bedId: 'R1',
            patientName: 'JUAN TEST',
            rut: '1-1'
        });

        render(<CudyrView />, { contextValue: createMockDailyRecordContext(record) });

        expect(screen.getByText('R1')).toBeInTheDocument();
        expect(screen.getByText('JUAN TEST')).toBeInTheDocument();
    });

    it('calculates occupied and categorized counts correctly', () => {
        const record = createMockRecord('2024-12-11');
        // Bed 1: Occupied and Categorized
        record.beds['R1'] = createMockPatient({
            bedId: 'R1',
            patientName: 'PACIENTE 1',
            cudyr: {
                changeClothes: 1, mobilization: 1, feeding: 1, elimination: 1,
                psychosocial: 1, surveillance: 1, vitalSigns: 1, fluidBalance: 1,
                oxygenTherapy: 1, airway: 1, proInterventions: 1, skinCare: 1,
                pharmacology: 1, invasiveElements: 1
            }
        });
        // Bed 2: Occupied but NOT Categorized (all zeros)
        record.beds['R2'] = createMockPatient({
            bedId: 'R2',
            patientName: 'PACIENTE 2',
            cudyr: {
                changeClothes: 0, mobilization: 0, feeding: 0, elimination: 0,
                psychosocial: 0, surveillance: 0, vitalSigns: 0, fluidBalance: 0,
                oxygenTherapy: 0, airway: 0, proInterventions: 0, skinCare: 0,
                pharmacology: 0, invasiveElements: 0
            }
        });

        render(<CudyrView />, { contextValue: createMockDailyRecordContext(record) });

        // Use within to find text in stats boxes to avoid split text issues
        const header = screen.getByRole('banner');
        expect(within(header).getByText(/Ocupadas:/i).parentElement).toHaveTextContent(/2/);
        expect(within(header).getByText(/Categ:/i).parentElement).toHaveTextContent(/1/);
    });

    it('updates CUDYR field when a radio button is clicked', () => {
        const record = createMockRecord('2024-12-11');
        record.beds['R1'] = createMockPatient({
            bedId: 'R1',
            patientName: 'JUAN TEST'
        });

        const mockContext = createMockDailyRecordContext(record);
        render(<CudyrView />, { contextValue: mockContext });

        // Find the "Change Clothes" input for R1
        // CudyrRow renders ScoreInput which is a type="number"
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '1' } });

        expect(mockContext.updateCudyr).toHaveBeenCalledWith('R1', 'changeClothes', 1);
    });

    it('renders and manages clinical cribs in CUDYR table', () => {
        const record = createMockRecord('2024-12-11');
        record.beds['R1'] = createMockPatient({
            bedId: 'R1',
            patientName: 'MADRE',
            clinicalCrib: {
                bedId: 'R1-C',
                patientName: 'BEBE',
                cudyr: {
                    changeClothes: 2, mobilization: 0, feeding: 0, elimination: 0,
                    psychosocial: 0, surveillance: 0, vitalSigns: 0, fluidBalance: 0,
                    oxygenTherapy: 0, airway: 0, proInterventions: 0, skinCare: 0,
                    pharmacology: 0, invasiveElements: 0
                }
            } as any
        });

        const mockContext = createMockDailyRecordContext(record);
        render(<CudyrView />, { contextValue: mockContext });

        expect(screen.getByText('R1')).toBeInTheDocument();
        expect(screen.getByText('R1 (CC)')).toBeInTheDocument();

        const header = screen.getByRole('banner');
        expect(within(header).getByText(/Ocupadas:/i).parentElement).toHaveTextContent(/2/);
        expect(within(header).getByText(/Categ:/i).parentElement).toHaveTextContent(/1/);
    });
});
