import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { buildSyncQueueStats } from '@/hooks/controllers/syncQueueMonitorController';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const mocks = vi.hoisted(() => ({
  useSyncQueueMonitor: vi.fn(),
  triggerImport: vi.fn(),
  retryClinicalFill: vi.fn(),
  useDailyRecordData: vi.fn(),
  useRayenImport: vi.fn(),
  useRayenFillProgress: vi.fn(),
}));

vi.mock('@/hooks/useSyncQueueMonitor', () => ({
  useSyncQueueMonitor: (options: unknown) => mocks.useSyncQueueMonitor(options),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mocks.useDailyRecordData(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => mocks.useRayenFillProgress(),
}));

vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
    connection: 'ready',
    report: {
      version: '0.6.0',
      protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
      checkedAt: '2026-07-14T05:00:00.000Z',
      fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
      gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
    },
    message: 'Extensión Eloísa v0.6.0 operativa.',
    canSync: true,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSyncQueueMonitor.mockReturnValue({
      stats: { pending: 0, failed: 0, conflict: 0, retrying: 0, oldestPendingAgeMs: 0 },
      operations: [],
      refresh: vi.fn(),
    });
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 0,
      total: 0,
      errors: 0,
      lastCompletedAt: null,
      outcome: null,
      attemptId: null,
      staffingOutcome: null,
    });
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      execution: null,
      diff: null,
      isPreviewOpen: false,
      result: null,
      error: null,
      staffingProposal: null,
      triggerImport: mocks.triggerImport,
      retryClinicalFill: mocks.retryClinicalFill,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });
  });

  it('consolidates old CUDYR archive failures in the Eloísa panel without a floating queue chip', async () => {
    mocks.useSyncQueueMonitor.mockReturnValue({
      stats: { pending: 0, failed: 17, conflict: 0, retrying: 0, oldestPendingAgeMs: 0 },
      operations: Array.from({ length: 12 }, (_, i) => ({
        id: i,
        type: 'ARCHIVE_CUDYR',
        status: 'FAILED',
        retryCount: 0,
        timestamp: 1,
        lastErrorCode: 'functions/failed-precondition',
        error:
          '[validation/functions/failed-precondition] Clinical enrichment is not authorized by the current global policy.',
      })),
      refresh: vi.fn(),
    });
    render(<RayenImportButton />);
    expect(screen.queryByTestId('sync-queue-status-chip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }));
    expect(await screen.findByText('Guardado local · 17 por enviar')).toBeInTheDocument();
    expect(screen.getAllByText(/CUDYR · autorización anterior/)).toHaveLength(1);
    expect(screen.queryByText('Registro del censo')).not.toBeInTheDocument();
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

  it('keeps active retries visible in the usual panel without triggering a sync', async () => {
    mocks.useSyncQueueMonitor.mockReturnValue({
      stats: { pending: 2, failed: 0, conflict: 0, retrying: 2, oldestPendingAgeMs: 0 },
      operations: [],
      refresh: vi.fn(),
    });
    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }));
    expect(await screen.findByText('Guardado local · 2 por enviar')).toBeInTheDocument();
    expect(screen.getByText('2 reintentando.')).toBeInTheDocument();
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'PROCESSING'] as const)(
    'reaches an older blocked send behind multiple pages of %s operations',
    async status => {
      const rows: SyncTask[] = Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        opId: `synthetic-page-${index}`,
        type: 'UPDATE_DAILY_RECORD',
        key:
          index === 24 ? 'daily:2026-10-22' : `daily:2026-02-${String(index + 1).padStart(2, '0')}`,
        payload: {},
        timestamp: 100 - index,
        status: index === 24 ? 'FAILED' : status,
        retryCount: status === 'PENDING' && index === 0 ? 1 : 0,
        ...(index === 24
          ? ({ lastErrorCategory: 'authorization', lastErrorCode: 'permission-denied' } as const)
          : {}),
      }));
      const stats = buildSyncQueueStats(buildSyncQueueTelemetryFromRows(rows, 1000, 25));
      mocks.useSyncQueueMonitor.mockImplementation(
        ({ operationLimit }: { operationLimit: number }) => ({
          stats,
          operations: rows.slice(0, operationLimit),
          refresh: vi.fn(),
        })
      );
      render(<RayenImportButton />);
      fireEvent.click(screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }));
      expect(await screen.findByText('Guardado local · 25 por enviar')).toBeVisible();
      expect(screen.queryByText('Censo del 22-10-2026')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ver más envíos' }));
      expect(screen.queryByText('Censo del 22-10-2026')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ver más envíos' }));
      expect(screen.getByText('Censo del 22-10-2026')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Descartar envío' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ver más envíos' })).not.toBeInTheDocument();
      expect(mocks.useSyncQueueMonitor).toHaveBeenCalledWith({ operationLimit: 13 });
      expect(mocks.useSyncQueueMonitor).toHaveBeenCalledWith({ operationLimit: 25 });
      expect(mocks.useSyncQueueMonitor).toHaveBeenCalledWith({ operationLimit: 37 });
      expect(mocks.triggerImport).not.toHaveBeenCalled();
      fireEvent.pointerDown(document.body);
      expect(mocks.useSyncQueueMonitor).toHaveBeenLastCalledWith({ operationLimit: 13 });
    }
  );

  it('exposes an unavailable send list even with zero counts and clears the warning after recovery', async () => {
    const queue = {
      stats: {
        pending: 0,
        failed: 0,
        conflict: 0,
        retrying: 0,
        oldestPendingAgeMs: 0,
        readState: 'ok',
        recentOperationsReadState: 'unavailable',
      },
      operations: [],
      refresh: vi.fn(),
    };
    mocks.useSyncQueueMonitor.mockReturnValue(queue);
    const { rerender } = render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }));
    expect(await screen.findByText('Guardado local · por comprobar')).toBeInTheDocument();
    expect(screen.getByText('No se pudo leer la cola local.')).toBeInTheDocument();
    expect(screen.queryByText('Guardado local · 0 por enviar')).not.toBeInTheDocument();
    expect(mocks.triggerImport).not.toHaveBeenCalled();

    mocks.useSyncQueueMonitor.mockReturnValue({
      ...queue,
      stats: { ...queue.stats, recentOperationsReadState: 'ok' },
    });
    rerender(<RayenImportButton />);
    expect(screen.queryByText('No se pudo leer la cola local.')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Guardado pendiente · Ver detalle' })
    ).not.toBeInTheDocument();
  });
  it('keeps a completed-change summary in the history instead of expanding the toolbar', () => {
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      execution: null,
      diff: null,
      isPreviewOpen: false,
      result: {
        applied: { admissions: 1, updates: 0, moves: 0, discharges: 0 },
        skipped: [],
      },
      error: null,
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });

    render(<RayenImportButton />);

    expect(screen.queryByTestId('rayen-import-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent(
      'Sincronizado: 1 ingresos'
    );
  });

  it('keeps a failed import visible even when older local writes need attention', () => {
    mocks.useSyncQueueMonitor.mockReturnValue({
      stats: { failed: 17, pending: 0, conflict: 0, oldestPendingAgeMs: 0 },
      operations: [],
      refresh: vi.fn(),
    });
    const error = 'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen.';
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      execution: {
        context: null,
        pending: null,
        stage: { type: 'failed' },
        outcome: { structuralConflicts: 0, skippedItems: 0 },
      },
      diff: null,
      isPreviewOpen: false,
      result: null,
      error,
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });

    render(<RayenImportButton />);

    const notice = screen.getByTestId('rayen-import-error');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo completar la sincronización');
    expect(screen.getByText(error)).not.toBeVisible();
    fireEvent.click(screen.getByText('Ver detalle'));
    expect(notice).toHaveAttribute('open');
    expect(screen.getByText(error)).toBeVisible();
  });

  it('labels a post-apply conflict review without reopening the nursing modal', () => {
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      diff: {
        admissions: [],
        updates: [
          {
            bedId: 'H2C1',
            rut: '22.025.389-9',
            patientName: 'Paciente prueba',
            changes: [],
            patient: {},
          },
        ],
        moves: [],
        discharges: [],
        pendingAdministrativeDischarges: [],
        conflicts: [{ bedId: 'H2C1', reason: 'Requiere revisión manual.' }],
        unchangedCount: 0,
        summary: {
          admissions: 0,
          updates: 1,
          moves: 0,
          discharges: 0,
          pendingAdministrativeDischarges: 0,
          conflicts: 1,
          unchanged: 0,
        },
      },
      isPreviewOpen: true,
      execution: {
        context: null,
        pending: null,
        stage: { type: 'needs_review', scope: 'post_commit' },
        outcome: { structuralConflicts: 1, skippedItems: 0 },
      },
      result: {
        record: {},
        applied: { admissions: 0, updates: 1, moves: 0, discharges: 0 },
        skipped: [],
      },
      staffingProposal: {
        censusDate: '2026-07-21',
        day: {
          names: ['Camila Leiva'],
          candidates: [],
          ignoredBoundaryRecords: 0,
          ambiguous: false,
        },
        night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByRole('button', { name: 'Revisar conflictos' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('1 cambio del censo requiere revisión');
    expect(screen.queryByText('Aplicar enfermería')).not.toBeInTheDocument();
  });

  it('groups adjacent successful checks without changes in the daily history', async () => {
    const quietEvent = (id: string, startedAt: string) => ({
      id,
      startedAt,
      completedAt: startedAt,
      by: 'Daniel Opazo',
      status: 'complete' as const,
      coverage: { total: 8, completed: 8, errors: 0, sourceErrors: 0, completedAt: startedAt },
      changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 8 },
      source: {
        extensionVersion: '0.6.0',
        fichaMedico: 'ready' as const,
        gestionCamas: 'ready' as const,
      },
    });
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSyncHistory: [
          quietEvent('quiet-3', '2026-07-14T13:00:00.000Z'),
          quietEvent('quiet-2', '2026-07-14T12:00:00.000Z'),
          quietEvent('quiet-1', '2026-07-14T11:00:00.000Z'),
        ],
      },
    });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    await screen.findByTestId('rayen-sync-history-modal');

    expect(screen.getByText('3 comprobaciones sin cambios')).toBeInTheDocument();
    expect(
      screen.getAllByText('Ext. v0.6.0 · Conexiones al iniciar: Ficha ✓ · Camas ✓')
    ).toHaveLength(1);
    expect(screen.queryByText('Sincronizado: 0 ingresos, 0 act., 0 mov., 0 egresos')).toBeNull();
  });

  it('keeps an applied event visible until clinical enrichment is complete', async () => {
    const appliedEvent = (id: string, startedAt: string) => ({
      id,
      startedAt,
      by: 'Daniel Opazo',
      status: 'applied' as const,
      changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 8 },
      source: {
        extensionVersion: '0.6.0',
        fichaMedico: 'ready' as const,
        gestionCamas: 'ready' as const,
      },
    });
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: { at: '2026-07-14T13:00:00.000Z', by: 'Daniel Opazo', status: 'applied' },
        rayenSyncHistory: [
          appliedEvent('applied-2', '2026-07-14T13:00:00.000Z'),
          appliedEvent('applied-1', '2026-07-14T12:00:00.000Z'),
        ],
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Sincronización pendiente de completar');
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    await screen.findByTestId('rayen-sync-history-modal');
    expect(screen.getAllByText('Censo aplicado')).toHaveLength(2);
    expect(screen.queryByText('2 comprobaciones sin cambios')).not.toBeInTheDocument();
  });

  it('does not expose a second last-sync information control in the toolbar', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: { rayenSync: { at: '2026-07-13T18:32:00.000Z', by: 'Daniel Opazo' } },
    });

    render(<RayenImportButton />);
    expect(
      screen.queryByRole('button', { name: 'Ver información de la última sincronización' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('rayen-sync-history-button')).toBeInTheDocument();
  });
});
