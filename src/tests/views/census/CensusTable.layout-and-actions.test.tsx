import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REGULAR_BEDS } from '@/constants/beds';
import {
  useDailyRecordBeds,
  useDailyRecordData,
  useDailyRecordMovements,
  useDailyRecordOverrides,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordDayActions,
} from '@/context/useDailyRecordScopedActions';
import { useTableConfig } from '@/context/TableConfigContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
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
  useDailyRecordMovements: vi.fn(),
  useDailyRecordBeds: vi.fn(),
  useDailyRecordStaff: vi.fn(),
  useDailyRecordOverrides: vi.fn(),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: vi.fn(),
  useDailyRecordDayActions: vi.fn(),
}));

vi.mock('@/features/census/hooks/useClinicalDocumentPresenceByBed', () => ({
  useClinicalDocumentPresenceByBed: vi.fn(() => ({})),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    role: 'viewer',
  })),
}));

const patientRowMock = vi.fn((_props: unknown) => <tr data-testid="patient-row" />);
vi.mock('@/features/census/components/PatientRow', () => ({
  PatientRow: (props: unknown) => patientRowMock(props),
}));

vi.mock('@/features/census/components/EmptyBedRow', () => ({
  EmptyBedRow: ({ bed, onClick }: { bed: { id: string }; onClick: () => void }) => (
    <tr data-testid="empty-bed-row">
      <td>{bed.id}</td>
      <td>
        <button type="button" data-testid={`empty-bed-button-${bed.id}`} onClick={onClick}>
          Agregar paciente
        </button>
      </td>
    </tr>
  ),
}));

vi.mock('@/components/modals/DemographicsModal', () => ({
  DemographicsModal: ({
    isOpen,
    onClose,
    onEmptySave,
    onSave,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onEmptySave?: () => void;
    onSave: (payload: Record<string, unknown>) => void;
  }) =>
    isOpen ? (
      <div data-testid="empty-bed-demographics-modal">
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" onClick={() => onEmptySave?.()}>
          Guardar Vacío
        </button>
        <button type="button" onClick={() => onSave({ patientName: 'Nuevo Paciente' })}>
          Guardar Paciente
        </button>
      </div>
    ) : null,
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

describe('CensusTable layout and actions', () => {
  const mockRecord = DataFactory.createMockDailyRecord('2025-01-08', {
    activeExtraBeds: ['E1'],
  });
  const mockConfirm = vi.fn();
  const mockHandleRowAction = vi.fn();
  const mockUpdateColumnWidth = vi.fn();
  const mockResetDay = vi.fn();
  const mockUpdatePatientMultiple = vi.fn();
  const mockMoveOrCopyPatient = vi.fn();

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
          scores: 56,
          cqx: 60,
          upc: 60,
        },
        pageMargin: 20,
        version: 1,
        lastUpdated: '2026-02-20T00:00:00.000Z',
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
    vi.mocked(useAuth).mockReturnValue(
      asContextReturn<ReturnType<typeof useAuth>>({
        user: null,
        role: 'viewer',
        isLoading: false,
        isAuthenticated: false,
        isEditor: false,
        isViewer: true,
        isFirebaseConnected: true,
        signOut: vi.fn(),
      })
    );

    vi.mocked(useDailyRecordData).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordData>>({
        record: mockRecord,
      })
    );

    vi.mocked(useDailyRecordDayActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordDayActions>>({
        resetDay: mockResetDay,
      })
    );
    vi.mocked(useDailyRecordBedActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordBedActions>>({
        updatePatient: vi.fn(),
        updatePatientMultiple: mockUpdatePatientMultiple,
        moveOrCopyPatient: mockMoveOrCopyPatient,
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
    patientRowMock.mockClear();
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
    vi.mocked(useAuth).mockReturnValue(
      asContextReturn<ReturnType<typeof useAuth>>({
        user: null,
        role: 'admin',
        isLoading: false,
        isAuthenticated: false,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        signOut: vi.fn(),
      })
    );

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

  it('should open demographics modal from the empty-bed add button', async () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    fireEvent.click(screen.getByTestId('empty-bed-button-R2'));

    expect(
      await screen.findByTestId('empty-bed-demographics-modal', {}, { timeout: 10000 })
    ).toBeInTheDocument();
    expect(mockUpdatePatientMultiple).not.toHaveBeenCalled();
  });

  it('should close the empty-bed demographics modal on cancel without persisting data', async () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    fireEvent.click(screen.getByTestId('empty-bed-button-R2'));
    fireEvent.click(await screen.findByText('Cancelar', {}, { timeout: 10000 }));

    expect(screen.queryByTestId('empty-bed-demographics-modal')).not.toBeInTheDocument();
    expect(mockUpdatePatientMultiple).not.toHaveBeenCalled();
  });

  it('should close the empty-bed demographics modal on empty save without persisting data', async () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    fireEvent.click(screen.getByTestId('empty-bed-button-R2'));
    fireEvent.click(await screen.findByText('Guardar Vacío', {}, { timeout: 10000 }));

    expect(screen.queryByTestId('empty-bed-demographics-modal')).not.toBeInTheDocument();
    expect(mockUpdatePatientMultiple).not.toHaveBeenCalled();
  });

  it('should persist demographics only when the empty-bed modal saves meaningful identity data', async () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    fireEvent.click(screen.getByTestId('empty-bed-button-R2'));
    fireEvent.click(await screen.findByText('Guardar Paciente', {}, { timeout: 10000 }));

    expect(mockUpdatePatientMultiple).toHaveBeenCalledWith('R2', {
      patientName: 'Nuevo Paciente',
    });
    expect(screen.queryByTestId('empty-bed-demographics-modal')).not.toBeInTheDocument();
  });
});
