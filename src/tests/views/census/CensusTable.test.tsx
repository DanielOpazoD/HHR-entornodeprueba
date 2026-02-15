import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REGULAR_BEDS } from '@/constants/beds';
import {
  useDailyRecordActions,
  useDailyRecordBeds,
  useDailyRecordData,
  useDailyRecordMovements,
  useDailyRecordOverrides,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useCensusActionCommands } from '@/features/census/context/censusActionContexts';
import { CensusTable } from '@/features/census/components/CensusTable';
import { DataFactory } from '../../factories/DataFactory';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(config => ({
    getVirtualItems: () =>
      Array.from({ length: config.count }, (_, i) => ({
        index: i,
        size: 44,
        start: i * 44,
      })),
    getTotalSize: () => config.count * 44,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
  })),
}));

vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
  useNotification: vi.fn(),
}));

vi.mock('@/context/TableConfigContext', () => ({
  useTableConfig: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: vi.fn(),
  useDailyRecordActions: vi.fn(),
  useDailyRecordMovements: vi.fn(),
  useDailyRecordBeds: vi.fn(),
  useDailyRecordStaff: vi.fn(),
  useDailyRecordOverrides: vi.fn(),
}));

vi.mock('@/features/census/components/PatientRow', () => ({
  PatientRow: () => <tr data-testid="patient-row" />,
}));

vi.mock('@/features/census/components/EmptyBedRow', () => ({
  EmptyBedRow: ({ bed, onClick }: { bed: { id: string }; onClick: () => void }) => (
    <tr data-testid="empty-bed-row" onClick={onClick}>
      <td>{bed.id}</td>
    </tr>
  ),
}));

vi.mock('@/components/ui/ResizableHeader', () => ({
  ResizableHeader: ({
    children,
    className,
    onResize,
  }: {
    children: React.ReactNode;
    className?: string;
    onResize?: (width: number) => void;
  }) => (
    <th className={className}>
      <span
        role="button"
        tabIndex={0}
        data-testid={`resize-${String(children)}`}
        onClick={() => onResize?.(120)}
        onKeyDown={() => onResize?.(120)}
      >
        {children}
      </span>
    </th>
  ),
}));

const asContextReturn = <T,>(value: Partial<T>): T => value as T;

describe('CensusTable', () => {
  const mockRecord = DataFactory.createMockDailyRecord('2025-01-08', {
    activeExtraBeds: ['E1'],
  });
  const mockConfirm = vi.fn();
  const mockHandleRowAction = vi.fn();
  const mockUpdateColumnWidth = vi.fn();
  const mockResetDay = vi.fn();

  const createUiMock = (): ReturnType<typeof useConfirmDialog> =>
    asContextReturn<ReturnType<typeof useConfirmDialog>>({
      notifications: [],
      notify: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      confirm: mockConfirm,
      alert: vi.fn(),
    });

  const createTableConfigMock = (): ReturnType<typeof useTableConfig> =>
    asContextReturn<ReturnType<typeof useTableConfig>>({
      config: {
        columns: {
          actions: 50,
          bed: 80,
          type: 60,
          name: 200,
          rut: 100,
          age: 50,
          diagnosis: 200,
          specialty: 80,
          status: 100,
          admission: 100,
          dmi: 60,
          cqx: 60,
          upc: 60,
        },
        pageMargin: 20,
        version: 1,
        lastUpdated: new Date().toISOString(),
      },
      isEditMode: false,
      isLoading: false,
      setEditMode: vi.fn(),
      updateColumnWidth: mockUpdateColumnWidth,
      updatePageMargin: vi.fn(),
      resetToDefaults: vi.fn(),
      exportConfig: vi.fn(),
      importConfig: vi.fn(),
    });

  const applyDefaultMocks = () => {
    vi.mocked(useDailyRecordData).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordData>>({
        record: mockRecord,
      })
    );

    vi.mocked(useDailyRecordActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordActions>>({
        resetDay: mockResetDay,
      })
    );

    vi.mocked(useDailyRecordMovements).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordMovements>>({
        discharges: [],
        transfers: [],
        cma: [],
      })
    );

    vi.mocked(useDailyRecordBeds).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordBeds>>({})
    );
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordStaff>>({
        activeExtraBeds: ['E1'],
      })
    );
    vi.mocked(useDailyRecordOverrides).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordOverrides>>({})
    );

    vi.mocked(useCensusActionCommands).mockReturnValue(
      asContextReturn<ReturnType<typeof useCensusActionCommands>>({
        handleRowAction: mockHandleRowAction,
      })
    );

    const uiMock = createUiMock();
    vi.mocked(useConfirmDialog).mockReturnValue(uiMock);
    vi.mocked(useNotification).mockReturnValue(uiMock);
    vi.mocked(useTableConfig).mockReturnValue(createTableConfigMock());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    applyDefaultMocks();
  });

  it('should render correct number of beds (normal + active extras)', () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    const emptyRows = screen.getAllByTestId('empty-bed-row');
    expect(emptyRows).toHaveLength(REGULAR_BEDS.length + 1);
    expect(screen.getByText('E1')).toBeInTheDocument();
    expect(screen.queryByText('E2')).not.toBeInTheDocument();
  });

  it('should handle "Clear All" with confirmation', async () => {
    mockConfirm.mockResolvedValue(true);
    render(<CensusTable currentDateString="2025-01-08" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle('Limpiar todos los datos del día'));
    });

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockResetDay).toHaveBeenCalled();
  });

  it('should toggle diagnosis mode', () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    fireEvent.click(screen.getByTitle(/Modo texto libre/));
    expect(localStorage.getItem('hhr_diagnosis_mode')).toBe('cie10');
    expect(screen.getByTitle(/Modo CIE-10/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(/Modo CIE-10/));
    expect(localStorage.getItem('hhr_diagnosis_mode')).toBe('free');
  });

  it('should render clinical crib as separate rows', () => {
    const mainPatient = DataFactory.createMockPatient('R1', {
      patientName: 'Mother',
      rut: '11.111.111-1',
    });
    mainPatient.clinicalCrib = DataFactory.createMockPatient('R1-crib', {
      patientName: 'Baby',
      rut: '1-1',
    });

    vi.mocked(useDailyRecordBeds).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordBeds>>({
        R1: mainPatient,
      })
    );

    render(<CensusTable currentDateString="2025-01-08" />);
    expect(screen.getAllByTestId('patient-row')).toHaveLength(2);
  });

  it('should handle column resize', () => {
    render(<CensusTable currentDateString="2025-01-08" />);
    fireEvent.click(screen.getByTestId('resize-Cama'));
    expect(mockUpdateColumnWidth).toHaveBeenCalledWith('bed', 120);
  });

  it('should initialize empty bed on click', () => {
    const updatePatientMock = vi.fn();
    vi.mocked(useDailyRecordActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordActions>>({
        updatePatient: updatePatientMock,
        resetDay: vi.fn(),
      })
    );

    render(<CensusTable currentDateString="2025-01-08" />);
    fireEvent.click(screen.getByText('R2'));
    expect(updatePatientMock).toHaveBeenCalledWith('R2', 'patientName', ' ');
  });
});
