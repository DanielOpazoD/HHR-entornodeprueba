import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
  retryClinicalFill: vi.fn(),
  useDailyRecordData: vi.fn(),
  useRayenImport: vi.fn(),
  useRayenFillProgress: vi.fn(),
  useRayenExtensionHealth: vi.fn(),
  refreshHealth: vi.fn(),
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
  useRayenExtensionHealth: () => mocks.useRayenExtensionHealth(),
}));
vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton history and progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      execution: null,
      diff: null,
      isPreviewOpen: false,
      result: null,
      error: null,
      staffingProposal: null,
      isStaffingProposalBusy: false,
      staffingProposalError: null,
      triggerImport: mocks.triggerImport,
      retryClinicalFill: mocks.retryClinicalFill,
      confirm: vi.fn(),
      cancel: vi.fn(),
      confirmStaffingProposal: vi.fn(),
      dismissStaffingProposal: vi.fn(),
    });
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
    const readyHealth = {
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
    };
    mocks.refreshHealth.mockResolvedValue(readyHealth);
    mocks.useRayenExtensionHealth.mockReturnValue({
      ...readyHealth,
      refresh: mocks.refreshHealth,
    });
  });

  it('keeps complete clinical coverage separate from a partial Camas source', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSyncHistory: [
          {
            id: 'run-camas',
            startedAt: '2026-07-14T10:00:00.000Z',
            completedAt: '2026-07-14T10:03:00.000Z',
            by: 'Daniel Opazo',
            status: 'partial',
            coverage: {
              total: 11,
              completed: 11,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-07-14T10:03:00.000Z',
            },
            source: { fichaMedico: 'ready', gestionCamas: 'missing' },
          },
        ],
      },
    });
    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    expect(screen.getByText('Gestión de Camas no disponible')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica: 11/11 completa')).toHaveClass('text-emerald-700');
  });

  it('shows what was structurally omitted instead of a generic partial message', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSyncHistory: [
          {
            id: 'run-structural',
            startedAt: '2026-08-23T22:00:00.000Z',
            completedAt: '2026-08-23T22:01:00.000Z',
            by: 'Operador',
            status: 'partial',
            changes: { admissions: 1, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
            coverage: {
              total: 10,
              completed: 10,
              errors: 0,
              sourceErrors: 0,
              completedAt: '2026-08-23T22:01:00.000Z',
            },
            structuralReview: {
              structureConfirmed: true,
              historicalCorrectionsPending: false,
              historicalCorrectionsRequireFreshCapture: false,
              isolatedConflicts: 1,
              issues: [{ bedId: 'H5C2', reason: 'occupied-local-bed' }],
            },
            source: { fichaMedico: 'ready', gestionCamas: 'ready' },
          },
        ],
      },
    });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));

    expect(screen.getByText('Cobertura clínica: 10/10 completa')).toHaveClass('text-emerald-700');
    expect(screen.getByTestId('rayen-structural-review-detail')).toHaveTextContent(
      'Cama H5C2: la cama está ocupada por otro paciente en HHR.'
    );
    expect(screen.queryByText('Enriquecimiento clínico parcial')).not.toBeInTheDocument();
  });

  it('keeps an unverified prior-shift backfill out of the current-day warning state', () => {
    const coverage = {
      total: 10,
      completed: 10,
      errors: 0,
      sourceErrors: 0,
      completedAt: '2026-08-23T22:01:00.000Z',
    };
    const structuralReview = {
      structureConfirmed: true,
      historicalCorrectionsPending: false,
      historicalCorrectionsRequireFreshCapture: false,
      isolatedConflicts: 0,
      deferredHistoricalAdmissionBedIds: ['H5C2'],
    };
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-08-23T22:00:00.000Z',
          by: 'Operador',
          runId: 'run-deferred-history',
          status: 'complete',
          coverage,
        },
        rayenSyncHistory: [
          {
            id: 'run-deferred-history',
            startedAt: '2026-08-23T22:00:00.000Z',
            completedAt: '2026-08-23T22:01:00.000Z',
            by: 'Operador',
            status: 'complete',
            changes: { admissions: 1, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
            coverage,
            structuralReview,
            source: { fichaMedico: 'ready', gestionCamas: 'ready' },
          },
        ],
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByRole('status')).toHaveTextContent('Todo al día');
    expect(screen.queryByTestId('rayen-sync-history-indicator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    expect(screen.getByText('Completa')).toBeInTheDocument();
    expect(screen.getByTestId('rayen-historical-admission-note')).toHaveTextContent(
      'El ingreso del día actual quedó sincronizado'
    );
    expect(screen.queryByTestId('rayen-structural-review-detail')).not.toBeInTheDocument();
  });

  it('resumes an applied clinical fill without requesting the census snapshot again', async () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-14T10:00:00.000Z',
          by: 'Daniel Opazo',
          runId: 'run-applied',
          status: 'applied',
        },
        rayenSyncHistory: [
          {
            id: 'run-applied',
            startedAt: '2026-07-14T10:00:00.000Z',
            by: 'Daniel Opazo',
            status: 'applied',
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
          },
        ],
      },
    });
    mocks.retryClinicalFill.mockResolvedValue(undefined);
    render(<RayenImportButton />);
    fireEvent.click(screen.getByTestId('rayen-sync-history-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar información clínica' }));
    await waitFor(() => expect(mocks.retryClinicalFill).toHaveBeenCalledOnce());
    expect(mocks.refreshHealth).not.toHaveBeenCalled();
    expect(mocks.triggerImport).not.toHaveBeenCalled();
  });

  it('shows the empty history state, closes with Escape and restores focus', async () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    render(<RayenImportButton />);
    const historyButton = screen.getByRole('button', {
      name: 'Abrir historial de sincronización del día, 0 eventos',
    });
    historyButton.focus();
    fireEvent.click(historyButton);
    expect(screen.getByText('Sin sincronizaciones registradas')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Historial de sincronización · hoy' })).toBeNull();
    await waitFor(() => expect(historyButton).toHaveFocus());
  });

  it('keeps the primary action width stable while the connection is checked', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenExtensionHealth.mockReturnValue({
      connection: 'checking',
      report: null,
      message: 'Comprobando conexión con la extensión.',
      canSync: false,
      refresh: mocks.refreshHealth,
    });
    render(<RayenImportButton />);
    expect(screen.getByRole('button', { name: 'Comprobando…' })).toHaveClass('w-40');
    expect(screen.getByTestId('rayen-operations-bar')).not.toHaveTextContent('Sincronizado:');
  });

  it('shows real clinical-fill progress without an invented global percentage', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenImport.mockReturnValue({
      ...mocks.useRayenImport(),
      execution: {
        context: null,
        pending: null,
        stage: { type: 'syncing_clinical' },
        outcome: { structuralConflicts: 0, skippedItems: 0 },
      },
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      done: 4,
      total: 8,
      errors: 0,
      lastCompletedAt: null,
    });
    render(<RayenImportButton />);
    const progress = screen.getByRole('progressbar', {
      name: 'Progreso de sincronización con Eloísa',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '4');
    expect(progress).toHaveAttribute('aria-valuemax', '8');
    expect(screen.getByTestId('rayen-sync-pulse')).toHaveTextContent(
      'Datos clínicos · 4 de 8 pacientes'
    );
    expect(screen.getByTestId('rayen-sync-pulse')).not.toHaveTextContent('%');
  });

  it('blocks a second import while a shared clinical fill survives a remount', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });
    mocks.useRayenFillProgress.mockReturnValue({
      running: true,
      done: 2,
      total: 5,
      errors: 0,
      lastCompletedAt: null,
      outcome: 'running',
      attemptId: 2,
      staffingOutcome: 'idle',
    });

    render(<RayenImportButton />);

    expect(screen.getByTestId('rayen-import-button')).toBeDisabled();
    expect(screen.getByTestId('rayen-sync-pulse')).toHaveTextContent(
      'Datos clínicos · 2 de 5 pacientes'
    );
    const progress = screen.getByRole('progressbar', {
      name: 'Progreso de sincronización con Eloísa',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '2');
    expect(progress).toHaveAttribute('aria-valuemax', '5');
  });
});
