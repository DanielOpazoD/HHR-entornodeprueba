import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';

const mocks = vi.hoisted(() => ({
  triggerImport: vi.fn(),
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

vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      result: null,
      error: null,
      triggerImport: mocks.triggerImport,
      confirm: vi.fn(),
      cancel: vi.fn(),
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 0,
      total: 0,
      errors: 0,
      lastCompletedAt: null,
    });
  });

  it('presents Eloísa as an operational source with visible provenance', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });
    mocks.useRayenFillProgress.mockReturnValue({
      running: false,
      done: 10,
      total: 10,
      errors: 0,
      lastCompletedAt: '2026-07-13T18:33:00.000Z',
    });

    render(<RayenImportButton />);

    expect(screen.getByTestId('rayen-operations-bar')).toBeInTheDocument();
    expect(screen.getByText('Fuente clínica externa')).toBeInTheDocument();
    expect(screen.getByText('Fuente actualizada')).toBeInTheDocument();
    expect(screen.getByText('Responsable')).toBeInTheDocument();
    expect(screen.getByText('Daniel Opazo')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('10/10 ✓')).toBeInTheDocument();
  });

  it('does not claim connectivity before the first successful synchronization', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);

    expect(screen.getByText('Pendiente de sincronizar')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización registrada')).toBeInTheDocument();
    expect(screen.getByText('Responsable')).toBeInTheDocument();
    expect(screen.getByText('Cobertura clínica')).toBeInTheDocument();
    expect(screen.getByText('Sin registro')).toBeInTheDocument();
    expect(screen.getByText('Sin sincronización')).toBeInTheDocument();
  });

  it('distinguishes a completed census sync from uncalculated clinical coverage', () => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-13T18:32:00.000Z',
          by: 'Daniel Opazo',
        },
      },
    });

    render(<RayenImportButton />);

    expect(screen.getByText('Fuente actualizada')).toBeInTheDocument();
    expect(screen.getByText('No calculada')).toBeInTheDocument();
  });

  it('keeps the existing reviewed synchronization action', () => {
    mocks.useDailyRecordData.mockReturnValue({ record: {} });

    render(<RayenImportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));

    expect(mocks.triggerImport).toHaveBeenCalledTimes(1);
  });
});
