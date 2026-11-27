import { createRequire } from 'node:module';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BEDS, HOSPITAL_CAPACITY } from '@/constants/beds';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecordMovementState } from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const require = createRequire(import.meta.url);
const {
  calculateMinsalStatistics,
} = require('../../../../functions/lib/minsal/minsalStatsCalculator.js');

const mockFetchRecordsRangeSorted = vi.fn();
const mockSyncRecordsRange = vi.fn();
const mockCallable = vi.fn();
const mockFetchReclassifications = vi.fn();

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    role: 'admin',
    currentUser: { role: 'admin' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/services/records/recordQueryService', () => ({
  fetchRecordsRangeSorted: (...args: unknown[]) => mockFetchRecordsRangeSorted(...args),
  syncRecordsRange: (...args: unknown[]) => mockSyncRecordsRange(...args),
}));

vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/features/analytics/services/analyticsSpecialtyReclassificationService', () => ({
  fetchAnalyticsSpecialtyReclassifications: (...args: unknown[]) =>
    mockFetchReclassifications(...args),
  saveAnalyticsSpecialtyReclassification: vi.fn().mockResolvedValue(undefined),
}));

import { AnalyticsView } from '@/features/analytics/public';

describe('AnalyticsView remote hospitalization snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchReclassifications.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
  });

  it('displays 1 current patient and 17 free beds on screen when falling back to remote MINSAL stats', async () => {
    const bed1 = BEDS[0];
    const remoteRecords: DailyRecordMovementState[] = [
      {
        date: '2026-03-10',
        beds: {
          [bed1.id]: {
            bedId: bed1.id,
            isBlocked: false,
            bedMode: 'Cama',
            hasCompanionCrib: false,
            patientName: 'Paciente Remoto',
            rut: '11.111.111-1',
            age: '40',
            pathology: 'Observación clínica',
            specialty: Specialty.CIRUGIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-03-10',
            hasWristband: true,
            devices: [],
            surgicalComplication: false,
            isUPC: false,
          } as PatientData,
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
    ];

    // No local records cached for the range -> useMinsalStats loads and renders the remote callable response.
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockCallable.mockImplementation(
      async ({ startDate, endDate }: { startDate: string; endDate: string }) => ({
        data: calculateMinsalStatistics({
          records: remoteRecords,
          hospitalCapacity: HOSPITAL_CAPACITY,
          startDate,
          endDate,
        }),
      })
    );

    const { wrapper: Wrapper } = createQueryClientTestWrapper({
      config: {
        defaultOptions: {
          queries: { retry: false, retryDelay: 0, gcTime: 0, staleTime: 0 },
        },
      },
    });

    render(
      <Wrapper>
        <AnalyticsView />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Hospitalización' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Hospitalización' }));

    const currentPatientsCard = screen
      .getByText('Pacientes del último registro')
      .closest('div')?.parentElement;
    const freeBedsCard = screen
      .getByText('Camas libres del último registro')
      .closest('div')?.parentElement;
    const blockedBedsCard = screen
      .getByText('Camas bloqueadas del último registro')
      .closest('div')?.parentElement;
    const occupancyCard = screen
      .getByText('Ocupación del último registro')
      .closest('div')?.parentElement;

    expect(currentPatientsCard).toHaveTextContent('1');
    expect(freeBedsCard).toHaveTextContent(String(HOSPITAL_CAPACITY - 1));
    expect(blockedBedsCard).toHaveTextContent('0');
    expect(occupancyCard).toHaveTextContent('5.6%');
  });

  it('preserves failure state instead of presenting an empty census when the remote MINSAL read fails', async () => {
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockCallable.mockRejectedValue(new Error('Remote MINSAL failure'));

    const { wrapper: Wrapper } = createQueryClientTestWrapper({
      config: {
        defaultOptions: {
          queries: { retry: false, retryDelay: 0, gcTime: 0, staleTime: 0 },
        },
      },
    });

    render(
      <Wrapper>
        <AnalyticsView />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/Remote MINSAL failure/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Pacientes del último registro')).not.toBeInTheDocument();
  });
});
