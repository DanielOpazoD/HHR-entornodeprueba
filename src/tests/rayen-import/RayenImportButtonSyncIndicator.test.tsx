import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RayenImportButton } from '@/features/rayen-import/components/RayenImportButton';
import { SYNC_TONE, SYNC_TONE_INFO_VARIANT } from '@/features/rayen-import/components/syncTone';
import {
  createIdleRayenFillProgress,
  createRayenImportState,
  createReadyRayenExtensionHealth,
} from './rayenImportButtonTestFixtures';

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
  useRayenFillProgress: () => createIdleRayenFillProgress(),
}));
vi.mock('@/features/rayen-import/hooks/useRayenExtensionHealth', () => ({
  useRayenExtensionHealth: () => ({
    ...createReadyRayenExtensionHealth({ report: null }),
    refresh: vi.fn(),
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
    mocks.useRayenImport.mockReturnValue(
      createRayenImportState({
        execution: {
          context: null,
          pending: null,
          stage: { type: 'syncing_clinical' },
          outcome: { structuralConflicts: 0, skippedItems: 0 },
        },
      })
    );
  });

  it('uses a neutral processing indicator instead of a warning tone while synchronizing', () => {
    render(<RayenImportButton />);

    const indicator = screen.getByTestId('rayen-sync-history-indicator');
    expect(indicator).not.toHaveAttribute('data-tone');
    expect(indicator).toHaveClass(SYNC_TONE_INFO_VARIANT.idle.dot);
    expect(indicator).not.toHaveClass(SYNC_TONE.review.dot, SYNC_TONE.action.dot, 'animate-pulse');
  });
});
