import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CensusView } from '@/views/census/CensusView';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import { useTableConfig } from '@/context/TableConfigContext';
import { usePatientHistoryQuery } from '@/hooks';

// Mock dependencies
vi.mock('@/hooks/useCensusLogic');
vi.mock('@/context/TableConfigContext');
vi.mock('@/hooks/usePatientHistoryQuery');
vi.mock('@/components/shared/SectionErrorBoundary', () => ({
    SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// Mock sub-components to simplify the view test
vi.mock('@/views/census/index', () => ({
    CensusActionsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    EmptyDayPrompt: () => <div data-testid="empty-day-prompt">Empty Day Prompt</div>,
    CensusTable: () => <div data-testid="census-table">Census Table</div>,
    DischargesSection: () => <div data-testid="discharges-section">Discharges Section</div>,
    TransfersSection: () => <div data-testid="transfers-section">Transfers Section</div>,
    CMASection: () => <div data-testid="cma-section">CMA Section</div>,
    CensusModals: () => <div data-testid="census-modals">Census Modals</div>,
    CensusStaffHeader: () => <div data-testid="census-staff-header">Census Staff Header</div>,
}));

vi.mock('@/views/analytics/AnalyticsView', () => ({
    AnalyticsView: () => <div data-testid="analytics-view">Analytics View</div>
}));

vi.mock('@/components/patient/PatientHistoryPanel', () => ({
    PatientHistoryPanel: () => <div data-testid="history-panel">History Panel</div>
}));

describe('CensusView', () => {
    const defaultProps = {
        viewMode: 'REGISTER' as const,
        selectedDay: 1,
        selectedMonth: 0,
        currentDateString: '2025-01-01',
        onOpenBedManager: vi.fn(),
        showBedManagerModal: false,
        onCloseBedManagerModal: vi.fn(),
    };

    const mockCensusLogic = {
        record: null,
        stats: {},
        previousRecordAvailable: false,
        previousRecordDate: '',
        availableDates: [],
        createDay: vi.fn(),
        resetDay: vi.fn(),
        updateNurse: vi.fn(),
        updateTens: vi.fn(),
        undoDischarge: vi.fn(),
        deleteDischarge: vi.fn(),
        undoTransfer: vi.fn(),
        deleteTransfer: vi.fn(),
        nursesList: [],
        tensList: []
    };

    beforeEach(() => {
        vi.mocked(useCensusLogic).mockReturnValue(mockCensusLogic as any);
        vi.mocked(useTableConfig).mockReturnValue({ config: { pageMargin: 20 } } as any);
        vi.mocked(usePatientHistoryQuery).mockReturnValue({ data: null, isLoading: false, error: null } as any);
    });

    it('renders AnalyticsView when viewMode is ANALYTICS', () => {
        render(<CensusView {...defaultProps} viewMode="ANALYTICS" />);
        expect(screen.getByTestId('analytics-view')).toBeInTheDocument();
    });

    it('renders EmptyDayPrompt when record is missing', () => {
        vi.mocked(useCensusLogic).mockReturnValue({ ...mockCensusLogic, record: null } as any);
        render(<CensusView {...defaultProps} />);
        expect(screen.getByTestId('empty-day-prompt')).toBeInTheDocument();
    });

    it('renders main census sections when record is present', () => {
        const mockRecord = { date: '2025-01-01', beds: {}, discharges: [], transfers: [] };
        vi.mocked(useCensusLogic).mockReturnValue({ ...mockCensusLogic, record: mockRecord } as any);

        render(<CensusView {...defaultProps} />);

        expect(screen.getByTestId('census-staff-header')).toBeInTheDocument();
        expect(screen.getByTestId('census-table')).toBeInTheDocument();
        expect(screen.getByTestId('discharges-section')).toBeInTheDocument();
        expect(screen.getByTestId('transfers-section')).toBeInTheDocument();
        expect(screen.getByTestId('cma-section')).toBeInTheDocument();
    });

    it('renders CensusModals when not in readOnly mode', () => {
        const mockRecord = { date: '2025-01-01', beds: {}, discharges: [], transfers: [] };
        vi.mocked(useCensusLogic).mockReturnValue({ ...mockCensusLogic, record: mockRecord } as any);

        render(<CensusView {...defaultProps} readOnly={false} />);
        expect(screen.getByTestId('census-modals')).toBeInTheDocument();
    });

    it('hides CensusModals in readOnly mode', () => {
        const mockRecord = { date: '2025-01-01', beds: {}, discharges: [], transfers: [] };
        vi.mocked(useCensusLogic).mockReturnValue({ ...mockCensusLogic, record: mockRecord } as any);

        render(<CensusView {...defaultProps} readOnly={true} />);
        expect(screen.queryByTestId('census-modals')).not.toBeInTheDocument();
    });
});
