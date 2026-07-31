import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';

const mocks = vi.hoisted(() => ({
  useDailyRecordData: vi.fn(),
  useRayenImport: vi.fn(),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mocks.useDailyRecordData(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenImport', () => ({
  useRayenImport: () => mocks.useRayenImport(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenFillStatus', () => ({
  useRayenFillProgress: () => ({ running: false, done: 0, total: 0, errors: 0 }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
    connection: 'ready',
    canSync: true,
    refresh: vi.fn(),
    report: null,
  }),
}));
vi.mock('@/features/rayen-import/components/RayenImportPreviewModal', () => ({
  RayenImportPreviewModal: () => null,
}));

describe('RayenImportButton sync indicator', () => {
  beforeEach(() => {
    mocks.useDailyRecordData.mockReturnValue({
      record: {
        rayenSync: {
          at: '2026-07-14T10:00:00.000Z',
          by: 'Daniel Opazo',
          runId: 'run-partial',
          status: 'partial',
          coverage: { total: 10, completed: 9, errors: 1, sourceErrors: 0 },
        },
        rayenSyncHistory: [
          {
            id: 'run-partial',
            startedAt: '2026-07-14T10:00:00.000Z',
            completedAt: '2026-07-14T10:02:00.000Z',
            by: 'Daniel Opazo',
            status: 'partial',
            coverage: { total: 10, completed: 9, errors: 1, sourceErrors: 0 },
            changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 10 },
          },
        ],
      },
    });
    mocks.useRayenImport.mockReturnValue({
      mode: 'preview',
      diff: null,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: true,
      result: null,
      hasSkippedItems: false,
      error: null,
      staffingProposal: null,
      isStaffingProposalBusy: false,
      staffingProposalError: null,
      triggerImport: vi.fn(),
      retryClinicalFill: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
      confirmStaffingProposal: vi.fn(),
      dismissStaffingProposal: vi.fn(),
    });
  });

  it('uses a neutral processing indicator instead of an amber warning while synchronizing', () => {
    render(<RayenImportButton />);

    expect(screen.getByTestId('rayen-sync-history-indicator')).toHaveClass(
      'bg-slate-300',
      'animate-pulse'
    );
    expect(screen.getByTestId('rayen-sync-history-indicator')).not.toHaveClass('bg-amber-500');
  });
});
