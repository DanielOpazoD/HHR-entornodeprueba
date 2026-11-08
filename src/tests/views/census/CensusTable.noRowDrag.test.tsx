import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { usePatientRowBindingsModel } from '@/features/census/components/patient-row/usePatientRowBindingsModel';
import { DataFactory } from '@/tests/factories/DataFactory';

// The real PatientRow, PatientMainRowView and EmptyBedRow render here; only the cell
// contents and the row bindings are stubbed.
vi.mock('@/features/census/context/censusActionContexts', () => ({
  useCensusActionCommands: vi.fn(),
}));
vi.mock('@/context/UIContext', () => ({ useConfirmDialog: vi.fn(), useNotification: vi.fn() }));
vi.mock('@/context/TableConfigContext', () => ({ useTableConfig: vi.fn() }));
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
vi.mock('@/features/census/hooks/usePendingBedClearIds', () => ({
  usePendingIntentionalClearTargets: vi.fn(() => ({
    bedIds: new Set<string>(),
    clinicalCribBedIds: new Set<string>(),
  })),
  usePendingClinicalCribCreates: vi.fn(() => new Map<string, unknown>()),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/census/components/patient-row/usePatientRowBindingsModel', () => ({
  usePatientRowBindingsModel: vi.fn(),
}));
vi.mock('@/features/census/components/patient-row/PatientMainRowActionCell', () => ({
  PatientMainRowActionCell: () => <td />,
}));
vi.mock('@/features/census/components/patient-row/PatientBedConfig', () => ({
  PatientBedConfig: () => <td />,
}));
vi.mock('@/features/census/components/patient-row/PatientInputCells', () => ({
  PatientInputCells: () => <td />,
}));

const asContextReturn = <T,>(value: Partial<T>): T => value as T;

describe('CensusTable rows', () => {
  const record = DataFactory.createMockDailyRecord('2025-01-08');
  const patient = DataFactory.createMockPatient('R1', { patientName: 'Paciente Sintético' });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useAuth).mockReturnValue(
      asContextReturn<ReturnType<typeof useAuth>>({ user: null, role: 'admin', isEditor: true })
    );
    vi.mocked(useDailyRecordData).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordData>>({ record })
    );
    vi.mocked(useDailyRecordDayActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordDayActions>>({ resetDay: vi.fn() })
    );
    vi.mocked(useDailyRecordBedActions).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordBedActions>>({
        updatePatient: vi.fn(),
        updatePatientMultiple: vi.fn(),
        moveOrCopyPatient: vi.fn(),
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
      asContextReturn<ReturnType<typeof useDailyRecordBeds>>({ R1: patient })
    );
    vi.mocked(useDailyRecordStaff).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordStaff>>({ activeExtraBeds: [] })
    );
    vi.mocked(useDailyRecordOverrides).mockReturnValue(
      asContextReturn<ReturnType<typeof useDailyRecordOverrides>>({})
    );
    vi.mocked(useCensusActionCommands).mockReturnValue(
      asContextReturn<ReturnType<typeof useCensusActionCommands>>({ handleRowAction: vi.fn() })
    );
    const ui = asContextReturn<ReturnType<typeof useConfirmDialog>>({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      confirm: vi.fn(),
      alert: vi.fn(),
    });
    vi.mocked(useConfirmDialog).mockReturnValue(ui);
    vi.mocked(useNotification).mockReturnValue(ui);
    vi.mocked(useTableConfig).mockReturnValue(
      asContextReturn<ReturnType<typeof useTableConfig>>({
        config: {
          columns: {
            actions: 50,
            bed: 80,
            type: 60,
            name: 200,
            access: 64,
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
        updateColumnWidth: vi.fn(),
      })
    );
    vi.mocked(usePatientRowBindingsModel).mockImplementation(
      ({ bed, bedType, data, currentDateString }) =>
        ({
          mainRowProps: {
            bed,
            bedType,
            data,
            currentDateString,
            readOnly: false,
            isBlocked: false,
            isEmpty: false,
            hasCompanion: false,
            hasClinicalCrib: false,
            isCunaMode: false,
            indicators: { hasClinicalDocument: false, isNewAdmission: false },
            mainRowViewState: {
              canToggleBedType: true,
              rowClassName: 'row',
              rowActionsAvailability: {},
              showBlockedContent: false,
            },
            onChange: {},
          },
          subRowProps: {},
          modalsProps: {},
        }) as never
    );
  });

  it('cannot be dragged to another bed in an editable census', () => {
    render(<CensusTable currentDateString="2025-01-08" />);

    const patientRow = screen.getByTestId('patient-row');
    expect(patientRow).toHaveAttribute('data-bed-id', 'R1');
    const table = screen.getByTestId('census-table');
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(1);
    expect(table.querySelector('[draggable="true"]')).toBeNull();
    expect(table.querySelector('.cursor-grab, .active\\:cursor-grabbing')).toBeNull();
  });
});
