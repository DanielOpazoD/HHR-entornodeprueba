import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CensusStaffHeader } from '@/features/census/components/CensusStaffHeader';
import { DataFactory } from '@/tests/factories/DataFactory';

const mockedUseDailyRecordActions = vi.fn();
const mockedUseDailyRecordStaff = vi.fn();
const mockedUseDailyRecordMovements = vi.fn();
const mockedUseStaffContext = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordActions: () => mockedUseDailyRecordActions(),
    useDailyRecordStaff: () => mockedUseDailyRecordStaff(),
    useDailyRecordMovements: () => mockedUseDailyRecordMovements()
}));

vi.mock('@/context/StaffContext', () => ({
    useStaffContext: () => mockedUseStaffContext()
}));

vi.mock('@/features/census/components/NurseSelector', () => ({
    NurseSelector: (props: {
        nursesDayShift: string[];
        nursesNightShift: string[];
        className?: string;
    }) => (
        <div data-testid="nurse-selector">
            <span data-testid="nurse-day">{JSON.stringify(props.nursesDayShift)}</span>
            <span data-testid="nurse-night">{JSON.stringify(props.nursesNightShift)}</span>
            <span data-testid="nurse-class">{props.className}</span>
        </div>
    )
}));

vi.mock('@/features/census/components/TensSelector', () => ({
    TensSelector: (props: {
        tensDayShift: string[];
        tensNightShift: string[];
        className?: string;
    }) => (
        <div data-testid="tens-selector">
            <span data-testid="tens-day">{JSON.stringify(props.tensDayShift)}</span>
            <span data-testid="tens-night">{JSON.stringify(props.tensNightShift)}</span>
            <span data-testid="tens-class">{props.className}</span>
        </div>
    )
}));

vi.mock('@/components/layout/SummaryCard', () => ({
    CombinedSummaryCard: (props: {
        discharges: unknown[];
        transfers: unknown[];
        cmaCount: number;
    }) => (
        <div data-testid="summary-card">
            <span data-testid="summary-discharges">{props.discharges.length}</span>
            <span data-testid="summary-transfers">{props.transfers.length}</span>
            <span data-testid="summary-cma">{props.cmaCount}</span>
        </div>
    )
}));

describe('CensusStaffHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseDailyRecordActions.mockReturnValue({
            updateNurse: vi.fn(),
            updateTens: vi.fn()
        });
        mockedUseDailyRecordStaff.mockReturnValue({
            nursesDayShift: ['Nurse A', 'Nurse B'],
            nursesNightShift: ['Nurse C', 'Nurse D'],
            tensDayShift: ['Tens A'],
            tensNightShift: ['Tens B']
        });
        mockedUseDailyRecordMovements.mockReturnValue({
            discharges: [{ id: 'd1' }],
            transfers: [{ id: 't1' }],
            cma: [{ id: 'c1' }, { id: 'c2' }]
        });
        mockedUseStaffContext.mockReturnValue({
            nursesList: ['Nurse A'],
            tensList: ['Tens A']
        });
    });

    it('renders selectors and summary with normalized movement counts', () => {
        render(<CensusStaffHeader stats={DataFactory.createMockStatistics()} />);

        expect(screen.getByTestId('nurse-selector')).toBeInTheDocument();
        expect(screen.getByTestId('tens-selector')).toBeInTheDocument();
        expect(screen.getByTestId('summary-card')).toBeInTheDocument();
        expect(screen.getByTestId('summary-discharges').textContent).toBe('1');
        expect(screen.getByTestId('summary-transfers').textContent).toBe('1');
        expect(screen.getByTestId('summary-cma').textContent).toBe('2');
    });

    it('passes readOnly class to selectors and hides summary when stats are null', () => {
        mockedUseDailyRecordStaff.mockReturnValue(null);
        mockedUseDailyRecordMovements.mockReturnValue(null);

        render(<CensusStaffHeader stats={null} readOnly={true} />);

        expect(screen.getByTestId('nurse-class').textContent).toBe('pointer-events-none opacity-80');
        expect(screen.getByTestId('tens-class').textContent).toBe('pointer-events-none opacity-80');
        expect(screen.getByTestId('nurse-day').textContent).toBe('[]');
        expect(screen.getByTestId('tens-night').textContent).toBe('[]');
        expect(screen.queryByTestId('summary-card')).not.toBeInTheDocument();
    });
});
