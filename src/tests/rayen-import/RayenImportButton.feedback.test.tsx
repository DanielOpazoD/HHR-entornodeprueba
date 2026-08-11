import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
  retryClinicalFill: vi.fn(),
  useDailyRecordData: vi.fn(),
  useRayenImport: vi.fn(),
  useRayenFillProgress: vi.fn(),
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
    refresh: vi.fn(),
  }),
}));

vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('keeps an import error compact until its accessible detail is requested', () => {
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
    expect(screen.getByRole('status')).toHaveTextContent('Sincronización requiere revisión');
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
    expect(screen.getByRole('status')).toHaveTextContent('Sincronización requiere revisión');
    expect(screen.queryByText('Aplicar enfermería')).not.toBeInTheDocument();
  });

  it('groups adjacent successful checks without changes in the daily history', () => {
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

    expect(screen.getByText('3 comprobaciones sin cambios')).toBeInTheDocument();
    expect(screen.getAllByText('Ext. v0.6.0 · Ficha ✓ · Camas ✓')).toHaveLength(1);
    expect(screen.queryByText('Sincronizado: 0 ingresos, 0 act., 0 mov., 0 egresos')).toBeNull();
  });

  it('keeps an applied event visible until clinical enrichment is complete', () => {
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
