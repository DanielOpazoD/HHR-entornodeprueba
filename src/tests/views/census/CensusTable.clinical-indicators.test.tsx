import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
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
  useClinicalDocumentPresenceByBed: vi.fn(() => ({ byBedId: {}, infoByBedId: {} })),
}));

vi.mock('@/features/census/hooks/usePendingBedClearIds', () => ({
  usePendingIntentionalClearTargets: vi.fn(() => ({
    bedIds: new Set<string>(),
    clinicalCribBedIds: new Set<string>(),
  })),
  usePendingClinicalCribCreates: vi.fn(() => new Map<string, unknown>()),
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

describe('CensusTable clinical indicators', () => {
  const mockRecord = DataFactory.createMockDailyRecord('2025-01-08', {
    activeExtraBeds: ['E1'],
  });
  const mockHandleRowAction = vi.fn();
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
      confirm: vi.fn(),
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
      updateColumnWidth: vi.fn(),
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
    vi.useRealTimers();
    patientRowMock.mockClear();
    applyDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should disable clinical document presence lookup for non-clinical roles', () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    expect(useClinicalDocumentPresenceByBed).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDateString: '2025-01-08',
        enabled: false,
      })
    );
  });

  it('should defer clinical document presence lookup for clinical roles until after initial table paint', async () => {
    vi.useFakeTimers();
    vi.mocked(useAuth).mockReturnValue(
      asContextReturn<ReturnType<typeof useAuth>>({
        user: null,
        role: 'nurse_hospital',
        isLoading: false,
        isAuthenticated: false,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        remoteSyncStatus: 'ready',
        signOut: vi.fn(),
      })
    );

    render(<CensusTable currentDateString="2025-01-08" />);

    expect(useClinicalDocumentPresenceByBed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentDateString: '2025-01-08',
        enabled: false,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useClinicalDocumentPresenceByBed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentDateString: '2025-01-08',
        enabled: true,
      })
    );
  });

  it('passes clinical-document and new-admission indicators to the main row binding', () => {
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente indicador',
      rut: '11.111.111-1',
      admissionDate: '2025-01-09',
      admissionTime: '07:30',
    });

    vi.mocked(useAuth).mockReturnValue(
      asContextReturn<ReturnType<typeof useAuth>>({
        user: null,
        role: 'nurse_hospital',
        isLoading: false,
        isAuthenticated: false,
        isEditor: true,
        isViewer: false,
        isFirebaseConnected: true,
        remoteSyncStatus: 'ready',
        signOut: vi.fn(),
      })
    );
    vi.mocked(useDailyRecordBeds).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordBeds>>({
        R1: patient,
      })
    );
    vi.mocked(useClinicalDocumentPresenceByBed).mockReturnValue({
      byBedId: { R1: true },
      infoByBedId: { R1: { present: true, totalCount: 1, draftCount: 0 } },
    });

    render(<CensusTable currentDateString="2025-01-08" />);

    expect(
      patientRowMock.mock.calls.some(call => {
        const props = call[0] as {
          indicators?: { hasClinicalDocument?: boolean; isNewAdmission?: boolean };
        };
        return (
          props.indicators?.hasClinicalDocument === true &&
          props.indicators?.isNewAdmission === true
        );
      })
    ).toBe(true);
  });
});
