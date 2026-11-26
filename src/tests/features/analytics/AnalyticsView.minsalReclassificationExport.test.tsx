import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsView } from '@/features/analytics/public';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { SpecialtyReclassification } from '@/features/analytics/types/minsalTypes';

const mockFetchRecordsRangeSorted = vi.fn();
const mockSyncRecordsRange = vi.fn();
const mockFetchReclassifications = vi.fn();
const mockSaveReclassification = vi.fn();
const mockDownloadBlob = vi.fn();

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

vi.mock('@/features/analytics/services/analyticsSpecialtyReclassificationService', () => ({
  fetchAnalyticsSpecialtyReclassifications: (...args: unknown[]) =>
    mockFetchReclassifications(...args),
  saveAnalyticsSpecialtyReclassification: (...args: unknown[]) => mockSaveReclassification(...args),
}));

vi.mock('@/utils/downloadBlob', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

const readBlobAsBuffer = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Expected ArrayBuffer from exported blob'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read exported blob'));
    reader.readAsArrayBuffer(blob);
  });

const readSpecialtyDischargeRows = async (blob: Blob): Promise<Array<[string, number]>> => {
  const buffer = await readBlobAsBuffer(blob);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Por Especialidad');
  if (!sheet) {
    throw new Error('Missing Por Especialidad sheet');
  }
  const rows: Array<[string, number]> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const specialty = String(row.getCell(1).value ?? '');
    if (specialty === 'Total') return;
    rows.push([specialty, Number(row.getCell(3).value ?? 0)]);
  });
  return rows;
};

const renderAnalyticsView = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryDelay: 0,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsView />
    </QueryClientProvider>
  );
};

describe('AnalyticsView MINSAL specialty reclassification export verification', () => {
  const recordDate = getTodayISO();

  const syntheticRecord = DataFactory.createMockDailyRecord(recordDate, {
    discharges: [
      {
        id: 'd-synthetic-1',
        bedName: 'Cama 1',
        bedId: 'bed-1',
        bedType: 'Cama',
        patientName: 'Paciente Sintético',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico sintético',
        time: '10:00',
        status: 'Vivo',
        specialty: 'Oftalmología',
      },
    ],
  });

  const syntheticReclassification: SpecialtyReclassification = {
    date: recordDate,
    movementKind: 'discharge',
    movementId: 'd-synthetic-1',
    specialty: 'Cirugía',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRecordsRangeSorted.mockResolvedValue([syntheticRecord]);
    mockSyncRecordsRange.mockResolvedValue([]);
  });

  it('exports the reclassified specialty in the reopened Por Especialidad sheet when reclassifications load', async () => {
    mockFetchReclassifications.mockResolvedValue([syntheticReclassification]);

    renderAnalyticsView();

    const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(exportButton).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(exportButton);

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Cirugía', 1]]);
  });

  it('exports the original specialty when the absence of reclassifications is confirmed', async () => {
    mockFetchReclassifications.mockResolvedValue([]);

    renderAnalyticsView();

    const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(exportButton).toBeEnabled();

    fireEvent.click(exportButton);

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Oftalmología', 1]]);
  });

  it('blocks Excel export and alerts on initial reclassification read failure, then recovers and exports the corrected workbook after retry', async () => {
    mockFetchReclassifications
      .mockRejectedValueOnce(new Error('Firestore unavailable'))
      .mockRejectedValueOnce(new Error('Firestore unavailable'))
      .mockResolvedValueOnce([syntheticReclassification]);

    renderAnalyticsView();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudieron verificar las reclasificaciones/i);

    const exportButton = screen.getByRole('button', { name: /Exportar Excel/i });
    expect(exportButton).toBeDisabled();

    fireEvent.click(exportButton);
    expect(mockDownloadBlob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }));
    expect(screen.queryByText('Sin reclasificaciones vigentes.')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No se pudieron verificar las reclasificaciones vigentes/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));
    expect(
      screen.getByText(/No se pudieron leer las reclasificaciones actuales/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/i }));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Cirugía', 1]]);
  });
});
