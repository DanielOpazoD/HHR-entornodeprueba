import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsView } from '@/features/analytics/public';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { SpecialtyReclassification } from '@/features/analytics/types/minsalTypes';

const mockFetchRecordsRangeSorted = vi.fn();
const mockSyncRecordsRange = vi.fn();
const mockFetchReclassifications = vi.fn();
const mockSaveReclassification = vi.fn();
const mockDownloadBlob = vi.fn();
const mockNotifyError = vi.fn();
const mockCallable = vi.fn();

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: mockNotifyError,
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
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

const renderAnalyticsView = (sharedQueryClient?: QueryClient) => {
  const queryClient =
    sharedQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
          gcTime: 0,
          staleTime: 0,
        },
      },
    });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AnalyticsView />
      </QueryClientProvider>
    ),
  };
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

  it('keeps Excel export disabled during a post-save retry window and exports Cirugía once the retry completes', async () => {
    const deferredRetry: { resolve?: (value: SpecialtyReclassification[]) => void } = {};
    const retryPromise = new Promise<SpecialtyReclassification[]>(resolve => {
      deferredRetry.resolve = resolve;
    });

    mockSaveReclassification.mockResolvedValue(undefined);
    mockFetchReclassifications
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('transient re-read error'))
      .mockImplementationOnce(() => retryPromise);

    renderAnalyticsView();

    const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(exportButton).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));
    const select = screen.getByLabelText('Reclasificar Paciente Sintético');
    fireEvent.change(select, { target: { value: 'Cirugía' } });

    await waitFor(() => expect(mockFetchReclassifications).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/i }));
    expect(mockDownloadBlob).not.toHaveBeenCalled();

    deferredRetry.resolve?.([syntheticReclassification]);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/i }));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Cirugía', 1]]);
  });

  it('keeps the warning visible and never reports empty reclassifications when retrying offline', async () => {
    mockFetchReclassifications.mockRejectedValue(new Error('Firestore unavailable'));

    renderAnalyticsView();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudieron verificar las reclasificaciones/i);

    try {
      onlineManager.setOnline(false);

      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }));
      expect(screen.queryByText('Sin reclasificaciones vigentes.')).not.toBeInTheDocument();
      expect(
        screen.getByText(/No se pudieron verificar las reclasificaciones vigentes/i)
      ).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('keeps Excel export disabled after remounting while a reclassification save is still in flight in the shared QueryClient', async () => {
    const sharedQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
          gcTime: 60_000,
          staleTime: 60_000,
        },
      },
    });
    const deferredSave: { resolve?: () => void } = {};
    let serverSaved = false;

    mockSaveReclassification.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          deferredSave.resolve = () => {
            serverSaved = true;
            resolve();
          };
        })
    );
    mockFetchReclassifications.mockImplementation(async () =>
      serverSaved ? [syntheticReclassification] : []
    );

    const firstMount = renderAnalyticsView(sharedQueryClient);
    const firstExport = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(firstExport).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));
    fireEvent.change(screen.getByLabelText('Reclasificar Paciente Sintético'), {
      target: { value: 'Cirugía' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled()
    );

    firstMount.unmount();

    renderAnalyticsView(sharedQueryClient);
    const remountedExport = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(remountedExport).toBeDisabled();

    fireEvent.click(remountedExport);
    expect(mockDownloadBlob).not.toHaveBeenCalled();

    deferredSave.resolve?.();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/i }));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Cirugía', 1]]);
  });

  it('reloads server state and exports Cirugía without unhandled rejection when save fails after server persistence', async () => {
    let serverPersisted = false;
    mockSaveReclassification.mockImplementation(async () => {
      serverPersisted = true;
      throw new Error('synthetic audit write failed');
    });
    mockFetchReclassifications.mockImplementation(async () =>
      serverPersisted ? [syntheticReclassification] : []
    );

    renderAnalyticsView();

    await screen.findByRole('button', { name: /Exportar Excel/i });
    fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));
    fireEvent.change(screen.getByLabelText('Reclasificar Paciente Sintético'), {
      target: { value: 'Cirugía' },
    });

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole('button', { name: /Exportar Excel/i }));
    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalledTimes(1));
    const blob = mockDownloadBlob.mock.calls[0]?.[0] as Blob;
    await expect(readSpecialtyDischargeRows(blob)).resolves.toEqual([['Cirugía', 1]]);
  });

  it('does not claim a successful server reload when both save and post-save reread fail', async () => {
    mockSaveReclassification.mockRejectedValue(new Error('synthetic audit unavailable'));
    mockFetchReclassifications
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('reclassifications unavailable'));

    renderAnalyticsView();

    await screen.findByRole('button', { name: /Exportar Excel/i });
    fireEvent.click(screen.getByRole('tab', { name: 'Especialidades' }));
    fireEvent.change(screen.getByLabelText('Reclasificar Paciente Sintético'), {
      target: { value: 'Cirugía' },
    });

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledTimes(1));
    expect(String(mockNotifyError.mock.calls[0]?.[1] ?? '')).not.toMatch(
      /Se recargó el estado actual desde el servidor/i
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled()
    );
  });

  it('retains last visible remote figures and blocks export when connectivity drops after reclassifications succeed but before the refreshed aggregate arrives', async () => {
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockFetchReclassifications.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      onlineManager.setOnline(false);
      return [];
    });
    mockCallable.mockResolvedValue({
      data: {
        periodStart: recordDate,
        periodEnd: recordDate,
        totalDays: 1,
        calendarDays: 1,
        diasCamaDisponibles: 18,
        diasCamaOcupados: 10,
        tasaOcupacion: 55.6,
        promedioDiasEstada: 2,
        egresosTotal: 1,
        egresosVivos: 1,
        egresosFallecidos: 0,
        egresosTraslados: 0,
        mortalidadHospitalaria: 0,
        indiceRotacion: 0.1,
        pacientesActuales: 10,
        camasOcupadas: 10,
        camasBloqueadas: 0,
        camasDisponibles: 18,
        camasLibres: 8,
        tasaOcupacionActual: 55.6,
        porEspecialidad: [],
      },
    });

    try {
      const warmClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            retryDelay: 0,
            gcTime: 60_000,
            staleTime: 60_000,
          },
        },
      });
      renderAnalyticsView(warmClient);

      const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
      expect(exportButton).toBeEnabled();
      expect(screen.getByText('55.6%')).toBeInTheDocument();

      fireEvent.click(screen.getByTitle('Actualizar datos'));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled()
      );
      expect(screen.getByText('55.6%')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('retains last visible remote figures, alert, and disabled export when the refreshed aggregate rejects on its final attempt', async () => {
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockFetchReclassifications.mockResolvedValue([]);
    mockCallable
      .mockResolvedValueOnce({
        data: {
          periodStart: recordDate,
          periodEnd: recordDate,
          totalDays: 1,
          calendarDays: 1,
          diasCamaDisponibles: 18,
          diasCamaOcupados: 10,
          tasaOcupacion: 55.6,
          promedioDiasEstada: 2,
          egresosTotal: 1,
          egresosVivos: 1,
          egresosFallecidos: 0,
          egresosTraslados: 0,
          mortalidadHospitalaria: 0,
          indiceRotacion: 0.1,
          pacientesActuales: 10,
          camasOcupadas: 10,
          camasBloqueadas: 0,
          camasDisponibles: 18,
          camasLibres: 8,
          tasaOcupacionActual: 55.6,
          porEspecialidad: [],
        },
      })
      .mockRejectedValue(new Error('network lost mid-flight'));

    const warmClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
          gcTime: 60_000,
          staleTime: 60_000,
        },
      },
    });
    renderAnalyticsView(warmClient);

    const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
    expect(exportButton).toBeEnabled();
    expect(screen.getByText('55.6%')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Actualizar datos'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('55.6%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('shows the verification alert and retry button instead of empty-census guidance when offline with no local records, and retains warm remote stats on offline refresh', async () => {
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockFetchReclassifications.mockResolvedValue([]);
    mockCallable.mockResolvedValue({
      data: {
        periodStart: recordDate,
        periodEnd: recordDate,
        totalDays: 1,
        calendarDays: 1,
        diasCamaDisponibles: 18,
        diasCamaOcupados: 10,
        tasaOcupacion: 55.6,
        promedioDiasEstada: 2,
        egresosTotal: 1,
        egresosVivos: 1,
        egresosFallecidos: 0,
        egresosTraslados: 0,
        mortalidadHospitalaria: 0,
        indiceRotacion: 0.1,
        pacientesActuales: 10,
        camasOcupadas: 10,
        camasBloqueadas: 0,
        camasDisponibles: 18,
        camasLibres: 8,
        tasaOcupacionActual: 55.6,
        porEspecialidad: [],
      },
    });

    try {
      onlineManager.setOnline(false);
      const offlineMount = renderAnalyticsView();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/No se pudieron verificar las reclasificaciones/i);
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
      expect(
        screen.queryByText(/Comienza a registrar datos en el censo diario/i)
      ).not.toBeInTheDocument();

      offlineMount.unmount();
      onlineManager.setOnline(true);

      const warmClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            retryDelay: 0,
            gcTime: 60_000,
            staleTime: 60_000,
          },
        },
      });
      renderAnalyticsView(warmClient);

      const exportButton = await screen.findByRole('button', { name: /Exportar Excel/i });
      expect(exportButton).toBeEnabled();
      expect(screen.getByText('55.6%')).toBeInTheDocument();

      onlineManager.setOnline(false);
      fireEvent.click(screen.getByTitle('Actualizar datos'));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Exportar Excel/i })).toBeDisabled();
      expect(screen.getByText('55.6%')).toBeInTheDocument();
      expect(
        screen.queryByText(/Comienza a registrar datos en el censo diario/i)
      ).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
