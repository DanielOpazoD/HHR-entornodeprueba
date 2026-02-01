import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, render, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { CudyrView } from '@/features/cudyr/components/CudyrView';
import { DataFactory } from '../../factories/DataFactory';
import { DailyRecord } from '@/types';

// Mock the useCudyrLogic hook directly
const mockUseCudyrLogic = vi.fn();

vi.mock('@/features/cudyr/hooks/useCudyrLogic', () => ({
    useCudyrLogic: () => mockUseCudyrLogic()
}));

const emptyCategoryCounts = {
    A1: 0, A2: 0, A3: 0,
    B1: 0, B2: 0, B3: 0,
    C1: 0, C2: 0, C3: 0,
    D1: 0, D2: 0, D3: 0
};

const createMockCudyrLogicReturn = (record: DailyRecord | null, overrides = {}) => ({
    record,
    visibleBeds: record ? [
        { id: 'R1', name: 'R1', type: 'UTI', isCuna: false },
        { id: 'R2', name: 'R2', type: 'UTI', isCuna: false }
    ] : [],
    stats: { total: 2, occupiedCount: 0, categorizedCount: 0 },
    cudyrSummary: {
        counts: {
            uti: { ...emptyCategoryCounts },
            media: { ...emptyCategoryCounts }
        },
        utiTotal: 0,
        mediaTotal: 0,
        totalDep: 0,
        totalRisk: 0,
        avgDep: 0,
        avgRisk: 0
    },
    canToggleLock: true,
    isEditingLocked: false,
    handleToggleLock: vi.fn(),
    handleScoreChange: vi.fn(),
    handleCribScoreChange: vi.fn(),
    wasAdmittedAfterLock: vi.fn().mockReturnValue(false),
    ...overrides
});

describe('CudyrView Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders empty message when no record is selected', () => {
        mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(null));

        render(<CudyrView />);
        expect(screen.getByText(/Seleccione una fecha con registros/i)).toBeInTheDocument();
    });

    it('renders patient rows correctly', () => {
        const record = DataFactory.createMockDailyRecord('2024-12-11');
        record.beds['R1'] = DataFactory.createMockPatient('R1', {
            patientName: 'JUAN TEST',
            rut: '1-1'
        });

        mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(record, {
            stats: { total: 2, occupiedCount: 1, categorizedCount: 0 }
        }));

        render(<CudyrView />);

        expect(screen.getByText('R1')).toBeInTheDocument();
        expect(screen.getByText('JUAN TEST')).toBeInTheDocument();
    });

    it('calculates occupied and categorized counts correctly', () => {
        const record = DataFactory.createMockDailyRecord('2024-12-11');
        record.beds['R1'] = DataFactory.createMockPatient('R1', {
            patientName: 'PACIENTE 1',
            cudyr: {
                changeClothes: 1, mobilization: 1, feeding: 1, elimination: 1,
                psychosocial: 1, surveillance: 1, vitalSigns: 1, fluidBalance: 1,
                oxygenTherapy: 1, airway: 1, proInterventions: 1, skinCare: 1,
                pharmacology: 1, invasiveElements: 1
            }
        });
        record.beds['R2'] = DataFactory.createMockPatient('R2', {
            patientName: 'PACIENTE 2'
        });

        mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(record, {
            stats: { total: 2, occupiedCount: 2, categorizedCount: 1 }
        }));

        render(<CudyrView />);

        const header = screen.getByRole('banner');
        expect(within(header).getByText(/Ocupadas:/i).parentElement).toHaveTextContent(/2/);
        expect(within(header).getByText(/Categ:/i).parentElement).toHaveTextContent(/1/);
    });

    it('updates CUDYR field when a radio button is clicked', () => {
        const record = DataFactory.createMockDailyRecord('2024-12-11');
        record.beds['R1'] = DataFactory.createMockPatient('R1', {
            patientName: 'JUAN TEST'
        });

        const mockHandleScoreChange = vi.fn();
        mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(record, {
            handleScoreChange: mockHandleScoreChange,
            stats: { total: 1, occupiedCount: 1, categorizedCount: 0 }
        }));

        render(<CudyrView />);

        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '1' } });

        expect(mockHandleScoreChange).toHaveBeenCalled();
    });

    it('renders and manages clinical cribs in CUDYR table', () => {
        const record = DataFactory.createMockDailyRecord('2024-12-11');
        record.beds['R1'] = DataFactory.createMockPatient('R1', {
            patientName: 'MADRE',
            clinicalCrib: DataFactory.createMockPatient('R1-C', {
                patientName: 'BEBE',
                cudyr: {
                    changeClothes: 2, mobilization: 0, feeding: 0, elimination: 0,
                    psychosocial: 0, surveillance: 0, vitalSigns: 0, fluidBalance: 0,
                    oxygenTherapy: 0, airway: 0, proInterventions: 0, skinCare: 0,
                    pharmacology: 0, invasiveElements: 0
                }
            })
        });

        mockUseCudyrLogic.mockReturnValue(createMockCudyrLogicReturn(record, {
            stats: { total: 2, occupiedCount: 2, categorizedCount: 1 }
        }));

        render(<CudyrView />);

        expect(screen.getByText('R1')).toBeInTheDocument();
        expect(screen.getByText('R1 (CC)')).toBeInTheDocument();

        const header = screen.getByRole('banner');
        expect(within(header).getByText(/Ocupadas:/i).parentElement).toHaveTextContent(/2/);
        expect(within(header).getByText(/Categ:/i).parentElement).toHaveTextContent(/1/);
    });
});

